'use strict';
// Inline markup of reStructuredText: emphasis, strong, literals, interpreted text and roles, hyperlink references
// (named, anonymous, embedded), footnote and citation references, substitutions, inline targets, standalone URLs
// and e-mail addresses, backslash escapes. Start and end rules follow the docutils "inline markup recognition rules".
const { esc, safeHref } = require('./sanitize');

const WS = /\s/;
// Characters allowed before a start-string and after an end-string (ASCII set from docutils plus common Unicode).
const OPEN_BEFORE = new Set(Array.from(`-:/'"<([{\u2018\u201c\u00ab\u2039\u2019\u201a\u201e\u2010\u2011\u2012\u2013\u2014\u00a0\u3000`));
const CLOSE_AFTER = new Set(Array.from(`-.,:;!?\\/'")]}>\u2019\u201d\u00bb\u203a\u2010\u2011\u2012\u2013\u2014\u00a0\u3000`));
const PAIRS = { "'": "'", '"': '"', '(': ')', '[': ']', '{': '}', '<': '>', '\u2018': '\u2019', '\u201c': '\u201d', '\u00ab': '\u00bb' };

function startOk(s, i, len) {
  const prev = i === 0 ? '' : s[i - 1];
  const next = s[i + len];
  if (next === undefined || WS.test(next)) return false;
  if (prev && !(WS.test(prev) || OPEN_BEFORE.has(prev))) return false;
  if (prev && PAIRS[prev] === next) return false; // "(*)" is not markup
  if (prev === '\\') return false;
  return true;
}
function endOk(s, j, len) {
  const prev = s[j - 1];
  const next = s[j + len];
  if (!prev || WS.test(prev)) return false;
  if (next !== undefined && !(WS.test(next) || CLOSE_AFTER.has(next))) return false;
  // escaped end-string: an odd number of backslashes before it
  let k = j - 1, bs = 0;
  while (k >= 0 && s[k] === '\\') { bs++; k--; }
  return bs % 2 === 0;
}

/** Remove backslash escapes: "\*" -> "*", "\ " -> "", "\\" -> "\". */
function unescape(s) { return s.replace(/\\(\s)|\\(.)/g, (m, w, c) => (w !== undefined ? '' : c)); }
const normName = s => unescape(s).replace(/\s+/g, ' ').trim().toLowerCase();

const URL_RE = /^(?:https?|ftp):\/\/[^\s<>"`]+|^mailto:[^\s<>"`]+/i;
const MAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const ROLE_PREFIX = /^:([A-Za-z0-9](?:[A-Za-z0-9]|[-_+:.](?=[A-Za-z0-9]))*):`/;
const ROLE_SUFFIX = /^:([A-Za-z0-9](?:[A-Za-z0-9]|[-_+:.](?=[A-Za-z0-9]))*):/;
const SIMPLE_REF = /^[A-Za-z0-9\u00c0-\uffff](?:[A-Za-z0-9\u00c0-\uffff]|[-_.+:](?=[A-Za-z0-9\u00c0-\uffff]))*(__?)/;
const WORD = /^[A-Za-z0-9\u00c0-\uffff_]+/;
const WORD_Y = /[A-Za-z0-9\u00c0-\uffff_]+/y;
const REF_Y = /[A-Za-z0-9\u00c0-\uffff](?:[A-Za-z0-9\u00c0-\uffff]|[-_.+:](?=[A-Za-z0-9\u00c0-\uffff]))*(__?)/y;
const AT_Y = /[A-Za-z0-9._%+-]*@/y;
const ALNUM = /[A-Za-z0-9\u00c0-\uffff]/;

/**
 * Renders inline text to HTML.
 * ctx: { ref(name) -> {href}|null, anon() -> href|null, sub(name) -> {html}|null, footnoteRef(label) -> {href, text}|null,
 *        role(name, text, raw) -> html, warn(message), targetId(name) -> id, math(tex) -> html, defaultRole }
 */
function renderInline(text, ctx, depth = 0) {
  const s = String(text);
  let out = '', i = 0, plain = '';
  const hasAt = s.indexOf('@') >= 0;
  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };
  const emit = h => { flush(); out += h; };
  // Cache of the next valid end-string per kind, so many unmatched start-strings stay linear in the text length.
  const memo = new Map();
  const end = (str, from, single = false, backtick = false, sub = false) => {
    const key = str + (single ? 's' : '') + (backtick ? 'b' : '') + (sub ? 'u' : '');
    const c = memo.get(key);
    if (c && from >= c.from && (c.at === -1 || from <= c.at)) return c.at === -1 || (sub && c.at === from - 1) ? (c.at === -1 ? -1 : findEndAt(s, str, from, single, backtick, sub)) : c.at;
    const at = findEndAt(s, str, from, single, backtick, sub);
    memo.set(key, { from, at });
    return at;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n === undefined) { i++; continue; }
      if (WS.test(n)) { i += 2; continue; }
      plain += n; i += 2; continue;
    }
    if (c === '`' && s[i + 1] === '`' && startOk(s, i, 2)) {
      const j2 = end('``', i + 3);
      if (j2 >= 0) { emit(`<code class="literal">${esc(s.slice(i + 2, j2))}</code>`); i = j2 + 2; continue; }
      ctx.warn('Inline literal start-string without end-string.'); plain += '``'; i += 2; continue;
    }
    if (c === '*' && s[i + 1] === '*' && startOk(s, i, 2)) {
      const j = end('**', i + 3);
      if (j >= 0) { emit(`<strong>${esc(unescape(s.slice(i + 2, j)))}</strong>`); i = j + 2; continue; }
      ctx.warn('Inline strong start-string without end-string.'); plain += '**'; i += 2; continue;
    }
    if (c === '*' && startOk(s, i, 1)) {
      const j = end('*', i + 2, true);
      if (j >= 0) { emit(`<em>${esc(unescape(s.slice(i + 1, j)))}</em>`); i = j + 1; continue; }
      ctx.warn('Inline emphasis start-string without end-string.'); plain += '*'; i += 1; continue;
    }
    if (c === ':' && startOk(s, i, 1)) {
      const m = ROLE_PREFIX.exec(s.slice(i, i + 120));
      if (m) {
        const b = i + m[0].length - 1;
        const j = end('`', b + 2, false, true);
        if (j >= 0 && s[j + 1] !== '_') {
          emit(ctx.role(m[1].toLowerCase(), s.slice(b + 1, j)));
          i = j + 1; continue;
        }
      }
    }
    if (c === '`' && startOk(s, i, 1)) {
      const j = end('`', i + 2, false, true);
      if (j >= 0) {
        const body = s.slice(i + 1, j);
        if (s[j + 1] === '_' && s[j + 2] === '_' && endOkAfter(s, j + 3)) { emit(reference(body, true, ctx)); i = j + 3; continue; }
        if (s[j + 1] === '_' && endOkAfter(s, j + 2)) { emit(reference(body, false, ctx)); i = j + 2; continue; }
        const r = ROLE_SUFFIX.exec(s.slice(j + 1, j + 121));
        if (r && endOkAfter(s, j + 1 + r[0].length)) { emit(ctx.role(r[1].toLowerCase(), body)); i = j + 1 + r[0].length; continue; }
        emit(ctx.role(ctx.defaultRole || 'title-reference', body));
        i = j + 1; continue;
      }
      ctx.warn('Inline interpreted text or phrase reference start-string without end-string.'); plain += '`'; i++; continue;
    }
    if (c === '_' && s[i + 1] === '`' && startOk(s, i, 2)) {
      const j = end('`', i + 3, false, true);
      if (j >= 0) {
        const name = s.slice(i + 2, j);
        emit(`<span class="target" id="${esc(ctx.targetId(normName(name)))}">${esc(unescape(name))}</span>`);
        i = j + 1; continue;
      }
    }
    if (c === '|' && startOk(s, i, 1)) {
      const j = end('|', i + 2, false, true, true);
      if (j >= 0) {
        const name = s.slice(i + 1, j);
        let k = j + 1, link = 0;
        if (s[k] === '_' && s[k + 1] === '_' && endOkAfter(s, k + 2)) { link = 2; k += 2; }
        else if (s[k] === '_' && endOkAfter(s, k + 1)) { link = 1; k += 1; }
        if (link || endOkAfter(s, k)) {
          const sub = ctx.sub(name);
          let h = sub ? sub.html : (ctx.warn(`Undefined substitution referenced: "${unescape(name)}".`), `<span class="problematic" title="Undefined substitution">|${esc(name)}|</span>`);
          if (link) {
            const r = link === 2 ? { href: ctx.anon() } : ctx.ref(normName(name));
            if (r && r.href) h = `<a class="reference" href="${esc(r.href)}">${h}</a>`;
          }
          emit(h); i = k; continue;
        }
      }
    }
    if (c === '[' && (i === 0 || startOk(s, i, 1))) {
      const m = /^\[(\d+|#[A-Za-z0-9_.-]*|\*|[A-Za-z0-9_.-]+)\]_(?!_)/.exec(s.slice(i, i + 120));
      if (m && endOkAfter(s, i + m[0].length)) {
        const r = ctx.footnoteRef(m[1]);
        if (r) emit(`<a class="${r.citation ? 'citation-reference' : 'footnote-reference'}" href="${esc(r.href)}" id="${esc(r.id || '')}">[${esc(r.text)}]</a>`);
        else { ctx.warn(`Unknown footnote or citation: [${m[1]}].`); emit(`<span class="problematic" title="No such footnote or citation">[${esc(m[1])}]_</span>`); }
        i += m[0].length; continue;
      }
    }
    if ((c === 'h' || c === 'H' || c === 'f' || c === 'm' || c === 'M') && (i === 0 || !/[A-Za-z0-9]/.test(s[i - 1]))) {
      const m = URL_RE.exec(s.slice(i, i + 4000));
      if (m) {
        let u = m[0];
        while (/[.,;:!?)\]'"]$/.test(u) && !(u.endsWith(')') && u.split('(').length > u.split(')').length - 1)) u = u.slice(0, -1);
        const ok = safeHref(u);
        emit(ok ? `<a class="reference external" href="${esc(ok)}">${esc(u)}</a>` : esc(u));
        i += u.length; continue;
      }
    }
    if (ALNUM.test(c) && (i === 0 || startOk(s, i, 0) || /[\s\-:/'"<([{]/.test(s[i - 1]))) {
      if (hasAt && (i === 0 || !/[A-Za-z0-9._%+-]/.test(s[i - 1]))) {
        AT_Y.lastIndex = i;
        if (AT_Y.test(s)) {
          const mail = MAIL_RE.exec(s.slice(i, i + 300));
          if (mail) { const u = mail[0].replace(/\.$/, ''); emit(`<a class="reference external" href="mailto:${esc(u)}">${esc(u)}</a>`); i += u.length; continue; }
        }
      }
      WORD_Y.lastIndex = i;
      const w = WORD_Y.exec(s);
      const after = w ? s[i + w[0].length] : undefined;
      if (w && (after === '_' || after === '-' || after === '.' || after === '+' || after === ':' || w[0].endsWith('_'))) {
        REF_Y.lastIndex = i;
        const m = REF_Y.exec(s);
        if (m && endOkAfter(s, i + m[0].length)) {
          const anon = m[1] === '__';
          emit(reference(m[0].slice(0, -m[1].length), anon, ctx, true)); i += m[0].length; continue;
        }
      }
      if (w) { plain += w[0]; i += w[0].length; continue; }
    }
    plain += c; i++;
  }
  flush();
  return out;
}

const endOkAfter = (s, k) => k >= s.length || WS.test(s[k]) || CLOSE_AFTER.has(s[k]);

// Finds the end-string at or after `from`. single: "*" must not be part of "**". noEmpty: the content is not empty.
function findEndAt(s, str, from, single = false, backtick = false, sub = false) {
  let j = s.indexOf(str, from - 1);
  let guard = 0;
  while (j >= 0) {
    if (++guard > 5000) return -1;
    if (j > 0 && (backtick ? backtickEndOk(s, j) : endOk(s, j, str.length))) {
      if (single && s[j + 1] === '*' && s[j - 1] !== '*') { j = s.indexOf(str, j + 2); continue; }
      if (backtick && s[j + 1] === '`') { j = s.indexOf(str, j + 2); continue; }
      if (sub && j === from - 1) { j = s.indexOf(str, j + 1); continue; }
      return j;
    }
    j = s.indexOf(str, j + 1);
  }
  return -1;
}

// "`" ends interpreted text when the suffix after it ("_", "__" or ":role:") is followed by an allowed character.
function backtickEndOk(s, j) {
  const prev = s[j - 1];
  if (!prev || WS.test(prev)) return false;
  let k = j - 1, bs = 0;
  while (k >= 0 && s[k] === '\\') { bs++; k--; }
  if (bs % 2) return false;
  let e = j + 1;
  if (s[e] === '_') { e++; if (s[e] === '_') e++; }
  else if (s[e] === ':') { const r = ROLE_SUFFIX.exec(s.slice(e, e + 120)); if (r) e += r[0].length; }
  return endOkAfter(s, e) || endOkAfter(s, j + 1);
}

/** A hyperlink reference: `text`_, `text <url>`_, `text <name_>`_, name_, and the anonymous forms with __. */
function reference(body, anon, ctx, simple = false) {
  let text = body, target = null, alias = null;
  const m = !simple && /^([\s\S]*?)\s*<([^<>]+)>$/.exec(body);
  if (m) {
    const inner = m[2].replace(/\s*\n\s*/g, ' ').trim();
    if (/[^\\]_$/.test(inner) || /^_$/.test(inner)) alias = inner.replace(/_$/, '');
    else target = unescape(inner.replace(/\s+/g, ''));
    text = m[1] || (alias || target);
  }
  const shown = esc(unescape(text).replace(/\s+/g, ' '));
  if (target !== null) {
    const ok = safeHref(target);
    if (!ok) { ctx.warn(`Link target refused: "${target.slice(0, 80)}" (only http, https, mailto, ftp and relative links are allowed).`); return `<span class="refused-link" title="Link refused">${shown}</span>`; }
    return `<a class="reference external" href="${esc(ok)}">${shown}</a>`;
  }
  let r;
  if (alias !== null) r = ctx.ref(normName(alias));
  else if (anon) r = { href: ctx.anon() };
  else r = ctx.ref(normName(text));
  if (!r || !r.href) {
    if (r && r.refused) return `<span class="refused-link" title="Link refused">${shown}</span>`;
    ctx.warn(anon ? 'Anonymous hyperlink mismatch: more anonymous references than anonymous targets.' : `Unknown target name: "${unescape(alias || text).replace(/\s+/g, ' ').slice(0, 80)}".`);
    return `<span class="problematic" title="Unknown target">${shown}</span>`;
  }
  const ext = !r.href.startsWith('#');
  return `<a class="reference ${ext ? 'external' : 'internal'}" href="${esc(r.href)}">${shown}</a>`;
}

module.exports = { renderInline, normName, unescape, startOk, endOk };
