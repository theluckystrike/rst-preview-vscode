'use strict';
// reStructuredText to HTML, written for RST Preview (no Python, no docutils). Two passes:
//   1. parse: lines -> block nodes (sections, lists, tables, directives, targets ...), includes resolved here;
//   2. render: collect targets, footnotes and substitutions, then write HTML with data-line attributes for scroll sync.
// Warnings (docutils "system messages") are collected with their line, for the Problems panel and the page.
const { esc, safeHref, sanitizeHtml, isDataImage } = require('./sanitize');
const { renderInline, normName, unescape } = require('./inline');
const { parseGrid, parseSimple, simpleTableEnd, parseCsv, SIMPLE_BORDER } = require('./tables');

const MAX_DEPTH = 60;          // nesting of block quotes, lists and directives
const MAX_INCLUDE_DEPTH = 5;
const MAX_INCLUDE_BYTES = 8 * 1024 * 1024;
const MAX_INCLUDES = 200; // included files per render (VER11)
const MAX_INCLUDE_TOTAL = 32 * 1024 * 1024; // included bytes per render (VER11)

// ---------------------------------------------------------------- lines

function toLines(text, f = 0) {
  const raw = String(text).replace(/^\ufeff/, '').split(/\r\n|\r|\n/);
  return raw.map((t, n) => ({ t: expandTabs(t).trimEnd(), n, f })); // trimEnd: /\s+$/ was quadratic on long indents (VER11)
}
function expandTabs(t) {
  if (t.indexOf('\t') < 0) return t;
  let o = '';
  for (const c of t) o += c === '\t' ? ' '.repeat(8 - (o.length % 8)) : c;
  return o;
}
const blank = l => !l.t;
const ind = l => l.t.length - l.t.trimStart().length;
function minIndent(ls) { let m = Infinity; for (const l of ls) if (l.t) m = Math.min(m, ind(l)); return m === Infinity ? 0 : m; }
function dedent(ls, k) { return ls.map(l => (l.t ? { t: l.t.slice(k), n: l.n, f: l.f } : l)); }
function trimBlank(ls) { let a = 0, b = ls.length; while (a < b && !ls[a].t) a++; while (b > a && !ls[b - 1].t) b--; return ls.slice(a, b); }
/** End (exclusive) of the lines from i that are blank or indented; trailing blank lines are not included. */
function indentedEnd(ls, i) { let j = i, last = i; while (j < ls.length && (!ls[j].t || ind(ls[j]) > 0)) { if (ls[j].t) last = j + 1; j++; } return last; }
/** First line known (text from column k), the following indented lines dedented by their own smallest indent. */
function firstKnown(ls, i, k) {
  const first = { t: ls[i].t.slice(k).trimStart(), n: ls[i].n, f: ls[i].f };
  const end = indentedEnd(ls, i + 1);
  const rest = ls.slice(i + 1, end);
  return { block: [first, ...dedent(rest, minIndent(rest))], end, restIndent: minIndent(rest) };
}

const ADORN_CH = /[!-\/:-@\[-`{-~]/;
function isAdorn(t) { if (t.length < 2 || !ADORN_CH.test(t[0])) return false; for (let i = 1; i < t.length; i++) if (t[i] !== t[0]) return false; return true; }
const width = s => Array.from(s).reduce((w, c) => w + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : /[\u0300-\u036f\u200b-\u200f]/.test(c) ? 0 : 1), 0);

const BULLET = /^([-*+\u2022\u2023\u2043])( +|$)/;
const ENUM = /^(?:(\d+|#|[a-zA-Z]|[ivxlcdm]+|[IVXLCDM]+)\.|(\d+|#|[a-zA-Z]|[ivxlcdm]+|[IVXLCDM]+)\)|\((\d+|#|[a-zA-Z]|[ivxlcdm]+|[IVXLCDM]+)\))( +|$)/;
const FIELD = /^:((?:[^:\\`]|\\.|`[^`]*`)+?):(?: +|$)/;
const OPT = /^((?:--?|\/)[A-Za-z0-9][\w-]*(?:[ =](?:<[^<>]+>|[\w.\-\/\[\]{}|]+))?(?:, (?:--?|\/)[A-Za-z0-9][\w-]*(?:[ =](?:<[^<>]+>|[\w.\-\/\[\]{}|]+))?)*)(?:  +|$)/;
const LINEBLOCK = /^\|( +|$)/;
const GRID_TOP = /^\+-[-+]*\+$/;
const DIRECTIVE = /^\.\. +([A-Za-z0-9](?:[\w.+:-]*[A-Za-z0-9])?)::(?: +|$)/;
const SUBDEF = /^\.\. +\|((?:[^|\\]|\\.)+)\| +([A-Za-z0-9](?:[\w.+:-]*[A-Za-z0-9])?)::(?: +|$)/;
const FOOTNOTE = /^\.\. +\[(\d+|#[A-Za-z0-9_.-]*|\*|[A-Za-z0-9_.-]+)\](?: +|$)/;
const TARGET = /^\.\. +_(`(?:[^`\\]|\\.)+`|(?:[^:\\]|\\.)*?|_):(?: +|$)/;

function enumInfo(m) {
  const v = m[1] || m[2] || m[3];
  const fmt = m[1] ? 'period' : m[2] ? 'paren' : 'parens';
  let type, ord;
  if (v === '#') { type = 'auto'; ord = null; }
  else if (/^\d+$/.test(v)) { type = 'arabic'; ord = parseInt(v, 10); }
  else if (/^[ivxlcdm]+$/.test(v) && (v.length > 1 || v === 'i')) { type = 'lowerroman'; ord = roman(v); }
  else if (/^[IVXLCDM]+$/.test(v) && (v.length > 1 || v === 'I')) { type = 'upperroman'; ord = roman(v); }
  else if (/^[a-z]$/.test(v)) { type = 'loweralpha'; ord = v.charCodeAt(0) - 96; }
  else if (/^[A-Z]$/.test(v)) { type = 'upperalpha'; ord = v.charCodeAt(0) - 64; }
  else return null;
  return { type, ord, fmt, len: m[0].length };
}
function roman(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let n = 0; s = s.toLowerCase();
  for (let i = 0; i < s.length; i++) { const a = v[s[i]], b = v[s[i + 1]] || 0; n += a < b ? -a : a; }
  return n;
}

// ---------------------------------------------------------------- parser

class Parser {
  constructor(opts, ctx) { this.opts = opts; this.ctx = ctx; }

  warn(l, message, level = 2) { if (this.ctx.warnings.length >= 1000) return; this.ctx.warnings.push({ line: l ? l.n : 0, file: l ? l.f : 0, message, level }); }

  parse(ls, depth = 0, top = false) {
    const out = [];
    if (depth > MAX_DEPTH) {
      this.warn(ls[0], `Nesting deeper than ${MAX_DEPTH} levels; the rest is shown as plain text.`);
      out.push({ type: 'literal', text: trimBlank(ls).map(l => l.t).join('\n'), line: ls[0] });
      return out;
    }
    let i = 0, prevBlank = true;
    const n = ls.length;
    while (i < n) {
      const l = ls[i];
      if (!l.t) { i++; prevBlank = true; continue; }
      const start = i;
      i = this.block(ls, i, out, depth, top, prevBlank);
      if (i <= start) i = start + 1; // never stall
      prevBlank = false;
    }
    return out;
  }

  // Parses one construct at ls[i]; returns the next index.
  block(ls, i, out, depth, top, prevBlank) {
    const l = ls[i], t = l.t, n = ls.length;
    if (ind(l) > 0) {
      const end = indentedEnd(ls, i);
      const body = ls.slice(i, end);
      const kids = this.parse(dedent(body, minIndent(body)), depth + 1);
      let attribution = null;
      const last = kids[kids.length - 1];
      if (last && last.type === 'paragraph' && /^(--|---|\u2014) *\S/.test(last.text)) { kids.pop(); attribution = last.text.replace(/^(--|---|\u2014) */, ''); }
      out.push({ type: 'blockquote', children: kids, attribution, line: l });
      return end;
    }
    if (/^\.\.( |$)/.test(t)) return this.explicit(ls, i, out, depth, top);
    if (/^__( +\S|$)/.test(t)) { // anonymous target, short form
      const fk = firstKnown(ls, i, 3);
      out.push({ type: 'target', anonymous: true, url: fk.block.map(x => x.t.trim()).join(''), line: l });
      return fk.end;
    }
    // Section title with overline.
    if (isAdorn(t) && i + 2 < n && ls[i + 1].t && isAdorn(ls[i + 2].t) && ls[i + 2].t[0] === t[0] && !isAdorn(ls[i + 1].t.trim())) {
      const title = ls[i + 1].t.trim();
      if (ls[i + 2].t !== t) this.warn(ls[i + 2], 'Title overline and underline do not match.');
      if (width(title) > t.length) this.warn(l, 'Title overline too short.');
      return this.title(out, title, t[0] + 'o', l, top, i + 3);
    }
    // Transition.
    if (isAdorn(t) && t.length >= 4 && (i + 1 >= n || !ls[i + 1].t)) {
      if (!prevBlank) this.warn(l, 'A transition needs a blank line before it.');
      out.push({ type: 'transition', line: l });
      return i + 1;
    }
    // Section title, underline only.
    if (i + 1 < n && (isAdorn(ls[i + 1].t) || (ls[i + 1].t.length === 1 && ADORN_CH.test(ls[i + 1].t) && width(t.trim()) === 1)) && !isAdorn(t) && ind(ls[i + 1]) === 0 && !SIMPLE_BORDER.test(ls[i + 1].t)) {
      const u = ls[i + 1].t;
      const w = width(t);
      if (w <= u.length || u.length >= 4) {
        if (w > u.length) this.warn(ls[i + 1], 'Title underline too short.');
        if (i + 2 >= n || !ls[i + 2].t || isAdorn(ls[i + 2].t) || !top) return this.title(out, t.trim(), u[0] + 'u', l, top, i + 2);
        return this.title(out, t.trim(), u[0] + 'u', l, top, i + 2);
      }
    }
    let m;
    if ((m = BULLET.exec(t))) return this.bulletList(ls, i, out, depth);
    if ((m = ENUM.exec(t))) { const r = this.enumList(ls, i, out, depth); if (r > i) return r; }
    if ((m = FIELD.exec(t)) && !/^:[^:]+:`/.test(t)) return this.fieldList(ls, i, out, depth);
    if (OPT.test(t) && /^(--?|\/)[A-Za-z0-9]/.test(t)) { const r = this.optionList(ls, i, out, depth); if (r > i) return r; }
    if (LINEBLOCK.test(t)) return this.lineBlock(ls, i, out);
    if (/^>>>( |$)/.test(t)) { let j = i; while (j < n && ls[j].t) j++; out.push({ type: 'doctest', text: ls.slice(i, j).map(x => x.t).join('\n'), line: l }); return j; }
    if (GRID_TOP.test(t)) return this.gridTable(ls, i, out, depth);
    if (SIMPLE_BORDER.test(t)) { const r = this.simpleTable(ls, i, out, depth); if (r > i) return r; }
    // Definition list item: a line followed at once by an indented line.
    if (i + 1 < n && ls[i + 1].t && ind(ls[i + 1]) > 0) return this.defList(ls, i, out, depth);
    return this.paragraph(ls, i, out, depth);
  }

  title(out, text, style, l, top, next) {
    if (!top) {
      this.warn(l, 'Unexpected section title (titles are allowed only at the top level, not inside lists, quotes or directives).');
      out.push({ type: 'paragraph', text, line: l, problem: true });
      return next;
    }
    const st = this.ctx.styles;
    let level = st.indexOf(style);
    if (level < 0) {
      const cur = this.ctx.curLevel;
      if (st.length > cur + 1) {
        // A new style deeper than the next known level: docutils calls this an inconsistent title level.
        this.warn(l, `Title level inconsistent: "${text.slice(0, 60)}" uses a new underline style where ${st.length > cur + 1 ? 'a known one' : 'none'} was expected.`);
      }
      st.push(style); level = st.length - 1;
    } else if (level > this.ctx.curLevel + 1) {
      this.warn(l, `Title level inconsistent: "${text.slice(0, 60)}" skips a level.`);
    }
    this.ctx.curLevel = level;
    out.push({ type: 'title', text, level: level + 1, line: l });
    return next;
  }

  paragraph(ls, i, out, depth) {
    let j = i;
    while (j < ls.length && ls[j].t && ind(ls[j]) === 0) j++;
    const lines = ls.slice(i, j);
    let text = lines.map(x => x.t).join('\n');
    const l = ls[i];
    if (j < ls.length && ls[j].t && ind(ls[j]) > 0) this.warn(ls[j], 'Unexpected indentation.');
    if (/::$/.test(text)) {
      if (text === '::') text = '';
      else if (/\s::$/.test(text)) text = text.replace(/\s*::$/, '');
      else text = text.slice(0, -1);
      if (text) out.push({ type: 'paragraph', text, line: l });
      let k = j;
      while (k < ls.length && !ls[k].t) k++;
      if (k < ls.length && ind(ls[k]) > 0) {
        const end = indentedEnd(ls, k);
        const body = ls.slice(k, end);
        out.push({ type: 'literal', text: dedent(body, minIndent(body)).map(x => x.t).join('\n'), line: ls[k], lang: this.ctx.highlightLang });
        return end;
      }
      if (k < ls.length && k > j && /^[!-\/:-@\[-`{-~]/.test(ls[k].t)) {
        const q = ls[k].t[0];
        let e = k;
        while (e < ls.length && ls[e].t && ls[e].t[0] === q) e++;
        out.push({ type: 'literal', text: ls.slice(k, e).map(x => x.t).join('\n'), line: ls[k] });
        return e;
      }
      this.warn(ls[Math.min(j, ls.length - 1)], 'Literal block expected; none found.', 2);
      return j;
    }
    out.push({ type: 'paragraph', text, line: l });
    return j;
  }

  bulletList(ls, i, out, depth) {
    const ch = ls[i].t[0];
    const items = [];
    let j = i;
    while (j < ls.length) {
      const m = BULLET.exec(ls[j].t);
      if (!m || m[1] !== ch || ind(ls[j]) !== 0) break;
      const fk = firstKnown(ls, j, m[0].length);
      items.push({ children: this.parse(trimBlank(fk.block), depth + 1), line: ls[j] });
      j = fk.end;
      let k = j; while (k < ls.length && !ls[k].t) k++;
      if (k < ls.length && BULLET.test(ls[k].t) && ls[k].t[0] === ch) j = k; else break;
    }
    out.push({ type: 'bullet_list', items, line: ls[i] });
    return j;
  }

  enumList(ls, i, out, depth) {
    const m0 = ENUM.exec(ls[i].t);
    const e0 = enumInfo(m0);
    if (!e0) return i;
    // "A. Einstein was ..." on two unindented lines is a paragraph, not a list.
    const nx = ls[i + 1];
    if (nx && nx.t && ind(nx) === 0 && !ENUM.test(nx.t)) return i;
    const items = [];
    let j = i, expect = e0.ord;
    while (j < ls.length) {
      const m = ENUM.exec(ls[j].t);
      if (!m || ind(ls[j]) !== 0) break;
      let e = enumInfo(m);
      if (!e || e.fmt !== e0.fmt) break;
      const v = m[1] || m[2] || m[3];
      // "i", "v", "x" after "h", "u", "w" are letters, not roman numerals.
      if (/roman/.test(e.type) && v.length === 1 && ((e0.type === 'loweralpha' && v === v.toLowerCase()) || (e0.type === 'upperalpha' && v === v.toUpperCase()))) e = { ...e, type: e0.type, ord: v.toLowerCase().charCodeAt(0) - 96 };
      if (!(e.type === e0.type || e.type === 'auto' || e0.type === 'auto')) break;
      if (e.type !== 'auto' && expect !== null && e.ord !== expect && items.length) { this.warn(ls[j], 'Enumerated list starts a new list: the number is not the next in order.', 1); break; }
      const fk = firstKnown(ls, j, m[0].length);
      items.push({ children: this.parse(trimBlank(fk.block), depth + 1), line: ls[j] });
      if (expect !== null) expect++;
      j = fk.end;
      let k = j; while (k < ls.length && !ls[k].t) k++;
      if (k < ls.length && ENUM.test(ls[k].t) && ind(ls[k]) === 0) j = k; else break;
    }
    const type = e0.type === 'auto' ? 'arabic' : e0.type;
    out.push({ type: 'enum_list', items, enumtype: type, start: e0.ord || 1, line: ls[i] });
    return j;
  }

  fieldList(ls, i, out, depth) {
    const items = [];
    let j = i;
    while (j < ls.length) {
      const m = FIELD.exec(ls[j].t);
      if (!m || ind(ls[j]) !== 0) break;
      const fk = firstKnown(ls, j, m[0].length);
      items.push({ name: m[1], children: this.parse(trimBlank(fk.block), depth + 1), line: ls[j] });
      j = fk.end;
      let k = j; while (k < ls.length && !ls[k].t) k++;
      if (k < ls.length && FIELD.test(ls[k].t)) j = k; else break;
    }
    out.push({ type: 'field_list', items, line: ls[i] });
    return j;
  }

  optionList(ls, i, out, depth) {
    const items = [];
    let j = i;
    while (j < ls.length) {
      const m = OPT.exec(ls[j].t);
      if (!m || ind(ls[j]) !== 0) break;
      const rest = ls[j].t.slice(m[0].length);
      if (!rest.trim() && !(ls[j + 1] && ls[j + 1].t && ind(ls[j + 1]) > 0)) break;
      const fk = firstKnown(ls, j, m[0].length);
      items.push({ opts: m[1].split(', '), children: this.parse(trimBlank(fk.block), depth + 1), line: ls[j] });
      j = fk.end;
      let k = j; while (k < ls.length && !ls[k].t) k++;
      if (k < ls.length && OPT.test(ls[k].t) && /^(--?|\/)[A-Za-z0-9]/.test(ls[k].t)) j = k; else break;
    }
    if (!items.length) return i;
    out.push({ type: 'option_list', items, line: ls[i] });
    return j;
  }

  lineBlock(ls, i, out) {
    const lines = [];
    let j = i;
    while (j < ls.length && ls[j].t) {
      const t = ls[j].t;
      if (LINEBLOCK.test(t)) {
        const body = t.replace(/^\|/, '');
        const sp = body.length - body.trimStart().length;
        lines.push({ text: body.trimStart(), indent: Math.max(0, sp - 1) });
      } else if (ind(ls[j]) > 0 && lines.length) lines[lines.length - 1].text += '\n' + t.trim();
      else break;
      j++;
    }
    out.push({ type: 'line_block', lines, line: ls[i] });
    return j;
  }

  gridTable(ls, i, out, depth) {
    let j = i;
    while (j < ls.length && ls[j].t && /^[+|]/.test(ls[j].t)) j++;
    const lines = ls.slice(i, j);
    const g = parseGrid(lines);
    if (g.error) { this.warn(ls[i], g.error); out.push({ type: 'literal', text: lines.map(x => x.t).join('\n'), line: ls[i], problem: true }); return j; }
    out.push(this.tableNode(g, ls[i], depth));
    return j;
  }

  simpleTable(ls, i, out, depth) {
    const end = simpleTableEnd(ls, i);
    if (end < 0) return i;
    const g = parseSimple(ls.slice(i, end));
    if (g.error) { this.warn(ls[i], g.error); out.push({ type: 'literal', text: ls.slice(i, end).map(x => x.t).join('\n'), line: ls[i], problem: true }); return end; }
    out.push(this.tableNode(g, ls[i], depth));
    return end;
  }

  tableNode(g, l, depth) {
    return { type: 'table', headRows: g.headRows, colCount: g.colCount, rows: g.rows.map(r => r.map(c => ({ rowspan: c.rowspan, colspan: c.colspan, children: this.parse(c.lines, depth + 1) }))), line: l };
  }

  defList(ls, i, out, depth) {
    const items = [];
    let j = i;
    while (j < ls.length && ls[j].t && ind(ls[j]) === 0 && ls[j + 1] && ls[j + 1].t && ind(ls[j + 1]) > 0
      && !/^\.\.( |$)/.test(ls[j].t) && !BULLET.test(ls[j].t) && !FIELD.test(ls[j].t)) {
      const term = ls[j].t;
      const end = indentedEnd(ls, j + 1);
      const body = ls.slice(j + 1, end);
      const parts = term.split(/ +: +/);
      items.push({ term: parts[0], classifiers: parts.slice(1), children: this.parse(dedent(body, minIndent(body)), depth + 1), line: ls[j] });
      j = end;
      let k = j; while (k < ls.length && !ls[k].t) k++;
      if (k < ls.length && ind(ls[k]) === 0 && ls[k + 1] && ls[k + 1].t && ind(ls[k + 1]) > 0 && !/^\.\.( |$)/.test(ls[k].t)
        && !BULLET.test(ls[k].t) && !ENUM.test(ls[k].t) && !FIELD.test(ls[k].t)) j = k; else break;
    }
    out.push({ type: 'def_list', items, line: ls[i] });
    return j;
  }

  explicit(ls, i, out, depth, top) {
    const l = ls[i], t = l.t;
    let m;
    if ((m = FOOTNOTE.exec(t))) {
      const fk = firstKnown(ls, i, m[0].length);
      const label = m[1];
      const isCite = !/^(\d+|#.*|\*)$/.test(label);
      out.push({ type: isCite ? 'citation' : 'footnote', label, children: this.parse(trimBlank(fk.block), depth + 1), line: l });
      return fk.end;
    }
    if ((m = TARGET.exec(t))) {
      const fk = firstKnown(ls, i, m[0].length);
      let name = m[1];
      const anonymous = name === '_';
      if (name.startsWith('`')) name = name.slice(1, -1);
      const url = fk.block.map(x => x.t.trim()).join(' ').trim();
      // A URL split over lines is joined without spaces; an alias (name_) keeps its spaces.
      const target = /_$/.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : url.replace(/\s+/g, '');
      out.push({ type: 'target', name: anonymous ? null : name, anonymous, url: target, line: l });
      return fk.end;
    }
    if ((m = SUBDEF.exec(t))) {
      const fk = firstKnown(ls, i, m[0].length);
      const d = this.directiveParts(m[2].toLowerCase(), fk.block, fk);
      out.push({ type: 'substitution_def', name: m[1], directive: d, line: l });
      return fk.end;
    }
    if ((m = DIRECTIVE.exec(t))) {
      const fk = firstKnown(ls, i, m[0].length);
      const name = m[2] === undefined ? m[1].toLowerCase() : m[1].toLowerCase();
      const d = this.directiveParts(name, fk.block, fk);
      d.line = l;
      this.directive(d, out, depth, top);
      return fk.end;
    }
    // Comment: the rest of the line and the indented block under it.
    const fk = firstKnown(ls, i, 2);
    out.push({ type: 'comment', line: l });
    return fk.end;
  }

  /** Split a directive block into arguments, options and content, the way docutils does. */
  directiveParts(name, block, fk) {
    const spec = DIRECTIVES[name] || DIRECTIVES[name.replace(/^[a-z]+:/, '')] || { args: 1, content: true };
    const lines = block.slice();
    let k = 0;
    const argLines = [];
    if (lines[0] && !lines[0].t) k = 1; // nothing after "::" on the first line
    else if (lines[0] && FIELD.test(lines[0].t) && !/^:[^:]+:`/.test(lines[0].t)) k = 0; // ".. contents:: :local:" starts with options
    else if (spec.args) {
      while (k < lines.length && lines[k].t && !(k > 0 && FIELD.test(lines[k].t))) { argLines.push(lines[k]); k++; }
    }
    const options = {};
    const optLine = {};
    while (k < lines.length && lines[k].t && FIELD.test(lines[k].t)) {
      const m = FIELD.exec(lines[k].t);
      let v = lines[k].t.slice(m[0].length);
      let j = k + 1;
      while (j < lines.length && lines[j].t && ind(lines[j]) > 0) { v += ' ' + lines[j].t.trim(); j++; }
      options[m[1].toLowerCase()] = v.trim();
      optLine[m[1].toLowerCase()] = lines[k];
      k = j;
    }
    const content = trimBlank(lines.slice(k));
    return { name, args: argLines.map(x => x.t.trim()).join(spec.joinArgs === false ? '\n' : ' ').trim(), argLines, options, optLine, content, spec };
  }

  directive(d, out, depth, top) {
    const { name } = d;
    const l = d.line;
    const kids = () => this.parse(d.content, depth + 1);
    const base = name.replace(/^(py|c|cpp|js|rst|std|sphinx|mat|php|rb|go|java|ts|dotnet|cs|net|f|http|ada|bash|cmake|lua|erl|el|scala|ex|jl|chpl|clj|swift|kt|rs|zig|hs):/, '');
    if (name === 'include' || name === 'literalinclude') return this.include(d, out, depth, top);
    if (ADMON[name]) { out.push({ type: 'admonition', kind: name, title: ADMON[name], children: kids(), line: l, options: d.options }); return; }
    switch (name) {
      case 'admonition': out.push({ type: 'admonition', kind: 'admonition', title: d.args || 'Note', inlineTitle: true, children: kids(), line: l, options: d.options }); return;
      case 'code': case 'code-block': case 'sourcecode': case 'highlight-block':
        out.push({ type: 'literal', text: d.content.map(x => x.t).join('\n'), lang: (d.args || this.ctx.highlightLang || '').split(/\s+/)[0], options: d.options, line: d.content[0] || l, block: l }); return;
      case 'testcode': case 'testoutput': case 'doctest': case 'testsetup': case 'testcleanup': case 'ipython': case 'jupyter-execute':
        out.push({ type: 'literal', text: d.content.map(x => x.t).join('\n'), lang: name === 'testoutput' ? '' : name === 'doctest' ? 'python-repl' : 'python', line: d.content[0] || l, block: l }); return;
      case 'deprecated-removed':
        out.push({ type: 'version', kind: 'deprecated', version: d.argLines[0] ? d.argLines[0].t.trim().split(/\s+/).slice(0, 2).join(', removed in ') : '', text: d.content.map(x => x.t).join('\n').trim(), line: l }); return;
      case 'plot': case 'bokeh-plot': case 'altair-plot':
        out.push({ type: 'sphinx_box', kind: 'diagram', label: `${name}${d.args ? ' ' + d.args : ''}`, note: 'A plot that Sphinx draws by running this code when it builds the docs. The code is shown here.', code: d.content.map(x => x.t).join('\n'), line: l }); return;
      case 'highlight': this.ctx.highlightLang = d.args.split(/\s+/)[0] || ''; return;
      case 'parsed-literal': out.push({ type: 'parsed_literal', text: d.content.map(x => x.t).join('\n'), line: l }); return;
      case 'math': out.push({ type: 'math_block', tex: [d.args, d.content.map(x => x.t).join('\n')].filter(Boolean).join('\n\n'), line: l, label: d.options.label || d.options.name }); return;
      case 'image': out.push({ type: 'image', uri: d.args.replace(/\s+/g, ''), options: d.options, line: l }); return;
      case 'figure': {
        const c = kids();
        out.push({ type: 'figure', uri: d.args.replace(/\s+/g, ''), options: d.options, caption: c[0] && c[0].type === 'paragraph' ? c[0] : null, legend: c[0] && c[0].type === 'paragraph' ? c.slice(1) : c, line: l });
        return;
      }
      case 'raw': return this.raw(d, out);
      case 'csv-table': return this.csvTable(d, out, depth);
      case 'list-table': return this.listTable(d, out, depth);
      case 'table': {
        const c = kids();
        const tbl = c.find(x => x.type === 'table');
        if (!tbl) { this.warn(l, 'The "table" directive needs a table in its content.'); out.push(...c); return; }
        tbl.caption = d.args; tbl.options = d.options; tbl.line = l; out.push(tbl); return;
      }
      case 'target-notes': out.push({ type: 'target_notes', line: l }); return;
      case 'contents': out.push({ type: 'contents', title: d.args || 'Contents', options: d.options, line: l }); return;
      case 'sectnum': case 'section-numbering': this.ctx.sectnum = true; return;
      case 'topic': out.push({ type: 'topic', title: d.args, children: kids(), line: l }); return;
      case 'sidebar': out.push({ type: 'sidebar', title: d.args, subtitle: d.options.subtitle, children: kids(), line: l }); return;
      case 'rubric': out.push({ type: 'rubric', text: d.args, line: l }); return;
      case 'epigraph': case 'highlights': case 'pull-quote': {
        const c = kids(); let attribution = null; const last = c[c.length - 1];
        if (last && last.type === 'paragraph' && /^(--|---|\u2014) *\S/.test(last.text)) { c.pop(); attribution = last.text.replace(/^(--|---|\u2014) */, ''); }
        out.push({ type: 'blockquote', cls: name, children: c, attribution, line: l }); return;
      }
      case 'compound': case 'container': case 'only': case 'ifconfig': case 'hlist': case 'class': case 'cssclass': case 'rst-class': case 'div':
        if (d.content.length) out.push({ type: 'container', cls: name === 'container' || name === 'class' || name === 'rst-class' ? d.args : name, children: kids(), line: l });
        return;
      case 'line-block': out.push({ type: 'line_block', lines: d.content.map(x => ({ text: x.t.trim(), indent: Math.max(0, ind(x)) })), line: l }); return;
      case 'title': this.ctx.docTitle = d.args; return;
      case 'meta': case 'header': case 'footer': case 'index': case 'tabularcolumns': case 'currentmodule': case 'module': case 'default-domain':
      case 'moduleauthor': case 'sectionauthor': case 'codeauthor': case 'program': case 'highlightlang': case 'nbinclude': case 'raw-latex':
        if (name === 'module' && d.args) out.push({ type: 'sig', kind: 'module', sig: d.args, children: [], line: l, small: true });
        return;
      case 'default-role': this.ctx.defaultRole = (d.args || 'title-reference').toLowerCase(); return;
      case 'role': {
        const m = /^([\w.+:-]+)(?:\(([\w.+:-]+)\))?/.exec(d.args);
        if (m) this.ctx.roles[m[1].toLowerCase()] = { base: (m[2] || '').toLowerCase(), cls: d.options.class || m[1].toLowerCase(), lang: d.options.language };
        return;
      }
      case 'seealso': out.push({ type: 'admonition', kind: 'seealso', title: 'See also', children: d.args ? [{ type: 'paragraph', text: d.args, line: l }, ...kids()] : kids(), line: l }); return;
      case 'todo': out.push({ type: 'admonition', kind: 'todo', title: 'Todo', children: kids(), line: l }); return;
      case 'versionadded': case 'versionchanged': case 'deprecated': case 'versionremoved':
        out.push({ type: 'version', kind: name, version: d.argLines[0] ? d.argLines[0].t.trim().split(/\s+/)[0] : '', text: [d.args.split(/\s+/).slice(1).join(' '), ...d.content.map(x => x.t)].join('\n').trim(), line: l }); return;
      case 'centered': out.push({ type: 'paragraph', text: d.args, cls: 'centered', line: l }); return;
      case 'glossary': out.push({ type: 'container', cls: 'glossary', children: kids(), line: l }); return;
      case 'productionlist': out.push({ type: 'literal', text: [d.args, ...d.content.map(x => x.t)].filter(Boolean).join('\n'), line: l }); return;
      case 'toctree': {
        const entries = d.content.map(x => x.t.trim()).filter(Boolean);
        out.push({ type: 'toctree', entries, options: d.options, line: l });
        return;
      }
      case 'graphviz': case 'digraph': case 'graph': case 'mermaid': case 'uml': case 'plantuml': case 'inheritance-diagram': case 'kroki':
        out.push({ type: 'sphinx_box', kind: 'diagram', label: `${name}${d.args ? ' ' + d.args : ''}`, note: 'A diagram that Sphinx draws when it builds the docs. The source is shown here.', code: d.content.map(x => x.t).join('\n'), line: l });
        return;
      case 'dropdown': case 'details': out.push({ type: 'details', title: d.args || 'Details', open: 'open' in d.options, children: kids(), line: l }); return;
      case 'tab': case 'tab-item': case 'group-tab': case 'code-tab': case 'card': case 'grid-item-card': case 'tabbed':
        out.push({ type: 'topic', title: d.args, cls: 'tab', children: name === 'code-tab' ? [{ type: 'literal', text: d.content.map(x => x.t).join('\n'), lang: d.args, line: l }] : kids(), line: l }); return;
      case 'tabs': case 'tab-set': case 'tab-set-code': case 'grid': case 'grid-item': case 'card-carousel':
        out.push({ type: 'container', cls: name, children: kids(), line: l }); return;
      case 'unicode': case 'replace': case 'date':
        this.warn(l, `The "${name}" directive is only valid in a substitution definition (.. |name| ${name}:: ...).`); return;
    }
    if (AUTODOC.has(base) || /^auto[a-z]+$/.test(base)) {
      out.push({ type: 'sphinx_box', kind: 'autodoc', label: `${name} ${d.args}`.trim(), note: 'Sphinx fills this in from the Python code when it builds the docs. RST Preview does not run Python, so the generated text is not shown.', children: kids(), line: l });
      return;
    }
    if (SIG.has(base) || /^(py|c|cpp|js|rst|std):/.test(name)) {
      out.push({ type: 'sig', kind: base, sig: d.args || '', children: kids(), line: l, options: d.options });
      return;
    }
    // Unknown directive: a labelled box with its content, never an error page.
    this.warn(l, `Unknown directive "${name}" (shown as a box; Sphinx extensions are not run).`, 1);
    let children = [];
    try { children = kids(); } catch { children = [{ type: 'literal', text: d.content.map(x => x.t).join('\n'), line: l }]; }
    out.push({ type: 'sphinx_box', kind: 'unknown', label: `${name}${d.args ? ' ' + d.args : ''}`, note: '', children, line: l });
  }

  raw(d, out) {
    const fmt = d.args.toLowerCase().split(/\s+/);
    if (d.options.file || d.options.url) { this.warn(d.line, 'raw :file: and :url: are not read by the preview (no file or network access for raw HTML).'); out.push({ type: 'notice', text: `raw ${d.args}: the :file:/:url: source is not loaded.`, line: d.line }); return; }
    if (!fmt.includes('html')) { out.push({ type: 'comment', line: d.line }); return; }
    out.push({ type: 'raw_html', html: d.content.map(x => x.t).join('\n'), line: d.line });
  }

  /** All includes of one render share a budget, so a file that includes another one many times cannot fill memory. */
  includeBudget(bytes, l, target, out) {
    const ctx = this.ctx;
    ctx.includeCount = (ctx.includeCount || 0) + 1; ctx.includeBytes = (ctx.includeBytes || 0) + bytes;
    if (ctx.includeCount <= MAX_INCLUDES && ctx.includeBytes <= MAX_INCLUDE_TOTAL) return true;
    if (!ctx.includeBudgetWarned) {
      ctx.includeBudgetWarned = true;
      this.warn(l, `Includes stopped: one preview reads at most ${MAX_INCLUDES} included files and ${MAX_INCLUDE_TOTAL >> 20} MB in all.`);
      out.push({ type: 'notice', text: `Includes stopped at ${MAX_INCLUDES} files or ${MAX_INCLUDE_TOTAL >> 20} MB: ${target}`, line: l });
    }
    return false;
  }

  include(d, out, depth, top) {
    const l = d.line;
    const ctx = this.ctx;
    let target = d.args.trim();
    if (!target) { this.warn(l, `The "${d.name}" directive needs a file name.`); return; }
    if (/^<.+>$/.test(target)) { // docutils standard substitution sets: <isonum.txt> and friends
      const set = target.slice(1, -1).replace(/\.txt$/, '');
      if (STD_SUBS[set]) { for (const [k, v] of Object.entries(STD_SUBS[set])) if (!ctx.subDefs.has(k)) ctx.subDefs.set(k, { text: v }); }
      else this.warn(l, `Standard include ${target} is not bundled; its substitutions will show as undefined.`, 1);
      return;
    }
    if (ctx.includeStack.length >= MAX_INCLUDE_DEPTH) { this.warn(l, `Include not read: more than ${MAX_INCLUDE_DEPTH} levels of nested includes ("${target}").`); out.push({ type: 'notice', text: `Include stopped at depth ${MAX_INCLUDE_DEPTH}: ${target}`, line: l }); return; }
    if ((ctx.includeCount || 0) >= MAX_INCLUDES) { this.includeBudget(0, l, target, out); return; }
    const r = this.opts.readFile ? this.opts.readFile(target, ctx.files[l.f]) : { error: 'Includes are not available here.' };
    if (!r || r.error) { this.warn(l, `Include not read: ${r ? r.error : 'no reader'}`); out.push({ type: 'notice', text: `${d.name} ${target}: ${r ? r.error : 'not read'}`, line: l }); return; }
    if (ctx.includeStack.includes(r.key) || r.key === ctx.files[0].key) { this.warn(l, `Include cycle stopped: "${target}" is already being included.`); out.push({ type: 'notice', text: `Include cycle stopped: ${target}`, line: l }); return; }
    if (r.text.length > MAX_INCLUDE_BYTES) { this.warn(l, `Include not read: "${target}" is larger than 8 MB.`); return; }
    if (!this.includeBudget(r.text.length, l, target, out)) return;
    let text = r.text;
    const o = d.options;
    if (o['start-after'] !== undefined) { const p = text.indexOf(o['start-after']); if (p >= 0) text = text.slice(p + o['start-after'].length); else this.warn(l, `Include: start-after text not found in "${target}".`); }
    if (o['end-before'] !== undefined) { const p = text.indexOf(o['end-before']); if (p >= 0) text = text.slice(0, p); else this.warn(l, `Include: end-before text not found in "${target}".`); }
    let lines = text.split(/\r\n|\r|\n/);
    if (o['start-line'] !== undefined || o['end-line'] !== undefined) lines = lines.slice(parseInt(o['start-line'] || '0', 10) || 0, o['end-line'] !== undefined ? parseInt(o['end-line'], 10) : undefined);
    if (o.lines) lines = pickLines(lines, o.lines);
    const f = ctx.files.length;
    ctx.files.push({ key: r.key, name: r.name, uri: r.uri, at: l.f === 0 ? l.n : ctx.files[l.f].at });
    if (d.name === 'literalinclude' || 'literal' in o || 'code' in o) {
      out.push({ type: 'literal', text: lines.join('\n').trimEnd(), lang: d.name === 'literalinclude' ? (o.language || guessLang(target)) : (o.code || ''), options: o, line: l, caption: o.caption });
      return;
    }
    ctx.includeStack.push(r.key);
    try {
      const ls = toLines(lines.join('\n'), f);
      out.push(...this.parse(ls, depth + 1, top));
    } finally { ctx.includeStack.pop(); }
  }

  csvTable(d, out, depth) {
    const o = d.options;
    let text;
    if (o.url) { this.warn(d.line, 'csv-table :url: is not loaded (the preview works offline).'); out.push({ type: 'notice', text: 'csv-table: the :url: source is not loaded (offline preview).', line: d.line }); return; }
    if (o.file) {
      const r = this.opts.readFile ? this.opts.readFile(o.file, this.ctx.files[d.line.f]) : { error: 'not available' };
      if (!r || r.error) { this.warn(d.line, `csv-table file not read: ${r ? r.error : ''}`); out.push({ type: 'notice', text: `csv-table ${o.file}: ${r ? r.error : 'not read'}`, line: d.line }); return; }
      if (!this.includeBudget(r.text.length, d.line, o.file, out)) return;
      text = r.text;
    } else text = d.content.map(x => x.t).join('\n');
    const delim = o.delim === 'tab' ? '\t' : o.delim === 'space' ? ' ' : (o.delim || ',').slice(0, 1);
    const rows = parseCsv(text, delim, (o.quote || '"').slice(0, 1), o.escape ? o.escape.slice(0, 1) : null, 'keepspace' in o).slice(0, 20000);
    const header = o.header ? parseCsv(o.header, delim, (o.quote || '"').slice(0, 1)) : [];
    const cell = s => ({ rowspan: 1, colspan: 1, children: this.parse(toLines(s, d.line.f).map(x => ({ ...x, n: d.line.n })), depth + 1) });
    const all = [...header, ...rows];
    const cols = Math.max(0, ...all.map(r => r.length));
    const pad = r => { const c = r.map(cell); while (c.length < cols) c.push({ rowspan: 1, colspan: 1, children: [] }); return c; };
    const headRows = header.length + (parseInt(o['header-rows'] || '0', 10) || 0);
    out.push({ type: 'table', caption: d.args, headRows, stub: parseInt(o['stub-columns'] || '0', 10) || 0, widths: o.widths, colCount: cols, rows: all.map(pad), line: d.line });
  }

  listTable(d, out, depth) {
    const kids = this.parse(d.content, depth + 1);
    const list = kids.find(k => k.type === 'bullet_list');
    if (!list || !list.items.every(it => it.children.length === 1 && it.children[0].type === 'bullet_list')) {
      this.warn(d.line, 'Malformed list-table: the content must be a bullet list of bullet lists (one inner list per row).');
      out.push(...kids); return;
    }
    const rows = list.items.map(it => it.children[0].items.map(c => ({ rowspan: 1, colspan: 1, children: c.children })));
    const cols = Math.max(...rows.map(r => r.length));
    rows.forEach(r => { while (r.length < cols) r.push({ rowspan: 1, colspan: 1, children: [] }); });
    if (rows.some(r => r.length !== rows[0].length)) this.warn(d.line, 'list-table rows have different lengths.', 1);
    out.push({ type: 'table', caption: d.args, headRows: parseInt(d.options['header-rows'] || '0', 10) || 0, stub: parseInt(d.options['stub-columns'] || '0', 10) || 0, widths: d.options.widths, colCount: cols, rows, line: d.line });
  }
}

function pickLines(lines, spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d*)\s*(-?)\s*(\d*)\s*$/.exec(part);
    if (!m) continue;
    const a = m[1] ? parseInt(m[1], 10) : 1, b = m[2] ? (m[3] ? parseInt(m[3], 10) : lines.length) : a;
    for (let k = a; k <= b && k <= lines.length && out.length < lines.length; k++) out.push(lines[k - 1]);
  }
  return out;
}
function guessLang(p) {
  const ext = (/\.([a-z0-9]+)$/i.exec(p) || [])[1] || '';
  return { py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml', c: 'c', h: 'c', cpp: 'cpp', rs: 'rust', go: 'go', java: 'java', toml: 'ini', ini: 'ini', cfg: 'ini', html: 'xml', xml: 'xml', css: 'css', sql: 'sql', rb: 'ruby' }[ext.toLowerCase()] || '';
}

const ADMON = { note: 'Note', warning: 'Warning', tip: 'Tip', important: 'Important', caution: 'Caution', danger: 'Danger', attention: 'Attention', hint: 'Hint', error: 'Error' };
const AUTODOC = new Set(['automodule', 'autoclass', 'autofunction', 'automethod', 'autoattribute', 'autoexception', 'autodata', 'autosummary', 'autoproperty', 'autodecorator', 'autoprogram', 'autoapimodule', 'autoapiclass', 'autoapifunction', 'click', 'argparse', 'jinja', 'autopydantic_model']);
const SIG = new Set(['function', 'class', 'method', 'attribute', 'data', 'exception', 'decorator', 'decoratormethod', 'staticmethod', 'classmethod', 'property', 'envvar', 'option', 'describe', 'object', 'confval', 'type', 'member', 'macro', 'struct', 'union', 'enum', 'enumerator', 'var', 'namespace', 'concept', 'directive', 'role', 'cmdoption', 'setting', 'event']);
// Argument spec: args = takes arguments on the first line(s). Body-only directives start their content on line 1.
const DIRECTIVES = {};
for (const k of Object.keys(ADMON)) DIRECTIVES[k] = { args: 0 };
for (const k of ['seealso', 'todo', 'epigraph', 'highlights', 'pull-quote', 'compound', 'parsed-literal', 'line-block', 'glossary', 'hlist', 'tabs', 'tab-set', 'grid', 'productionlist']) DIRECTIVES[k] = { args: 0 };
for (const k of ['math']) DIRECTIVES[k] = { args: 1 };
for (const k of ['toctree']) DIRECTIVES[k] = { args: 0 };

const STD_SUBS = {
  isonum: { copy: '\u00a9', reg: '\u00ae', trade: '\u2122', half: '\u00bd', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', deg: '\u00b0', plusmn: '\u00b1', micro: '\u00b5', para: '\u00b6', middot: '\u00b7', sect: '\u00a7', laquo: '\u00ab', raquo: '\u00bb', cent: '\u00a2', pound: '\u00a3', yen: '\u00a5', euro: '\u20ac', times: '\u00d7', divide: '\u00f7', nbsp: '\u00a0', shy: '\u00ad', iexcl: '\u00a1', iquest: '\u00bf', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', check: '\u2713', cross: '\u2717', hyphen: '\u2010', sup2: '\u00b2', sup3: '\u00b3', ohm: '\u2126', excl: '!', num: '#', dollar: '$', percnt: '%', amp: '&', ast: '*', commat: '@', lowbar: '_', verbar: '|', quot: '"', apos: "'" },
  isopub: { mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', bull: '\u2022', dagger: '\u2020', Dagger: '\u2021', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', trade: '\u2122', emsp: '\u2003', ensp: '\u2002', thinsp: '\u2009', hyphen: '\u2010', dash: '\u2010', nldr: '\u2025', prime: '\u2032', Prime: '\u2033', star: '\u2606', starf: '\u2605', male: '\u2642', female: '\u2640', phone: '\u260e' },
  isotech: { infin: '\u221e', ne: '\u2260', le: '\u2264', ge: '\u2265', asymp: '\u2248', equiv: '\u2261', sum: '\u2211', prod: '\u220f', radic: '\u221a', part: '\u2202', nabla: '\u2207', isin: '\u2208', notin: '\u2209', and: '\u2227', or: '\u2228', cap: '\u2229', cup: '\u222a', int: '\u222b', forall: '\u2200', exist: '\u2203', empty: '\u2205', minus: '\u2212', rArr: '\u21d2', lArr: '\u21d0', hArr: '\u21d4', harr: '\u2194' },
  isogrk1: { alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', epsilon: '\u03b5', pi: '\u03c0', sigma: '\u03c3', mu: '\u03bc', lambda: '\u03bb', omega: '\u03c9', theta: '\u03b8', phi: '\u03c6', Delta: '\u0394', Sigma: '\u03a3', Omega: '\u03a9', Pi: '\u03a0' },
};
STD_SUBS.isogrk3 = STD_SUBS.isogrk1;
STD_SUBS['xhtml1-special'] = { ...STD_SUBS.isopub, euro: '\u20ac' };
STD_SUBS['xhtml1-lat1'] = STD_SUBS.isonum;
STD_SUBS['xhtml1-symbol'] = { ...STD_SUBS.isotech, ...STD_SUBS.isogrk1 };

// ---------------------------------------------------------------- render

/** Text of a title without inline markup, as docutils uses it for the section's reference name. */
function plainTitle(t) {
  return unescape(String(t)
    .replace(/``([\s\S]*?)``/g, '$1')
    .replace(/:[\w.+:-]+:`([\s\S]*?)`/g, (m, x) => x.replace(/^[~!]/, '').replace(/^(.*?)\s*<[^<>]*>$/, '$1'))
    .replace(/`([\s\S]*?)`(__?|:[\w.+:-]+:)?/g, (m, x) => x.replace(/^(.*?)\s*<[^<>]*>$/, '$1'))
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1').replace(/\*([^*\s][\s\S]*?)\*/g, '$1')
    .replace(/\|([^|]+)\|_{0,2}/g, '$1').replace(/\b([\w.-]+)__?(?=\W|$)/g, '$1')).replace(/\s+/g, ' ').trim();
}

function makeId(name, used) {
  let id = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[-0-9]+|-+$/g, '');
  if (!id) id = 'id';
  let out = id;
  if (used.has(out)) {
    const next = used.nextNumber || (used.nextNumber = new Map());
    let k = next.get(id) || 1;
    do out = `${id}-${k++}`; while (used.has(out));
    next.set(id, k);
  }
  used.add(out);
  return out;
}

/** First item after index k that matches (no copy of the rest of the list). */
function findAfter(list, k, pred) { for (let i = k + 1; i < list.length; i++) if (pred(list[i])) return list[i]; return undefined; }

const SYMBOLS = ['*', '\u2020', '\u2021', '\u00a7', '\u00b6', '#', '\u2660', '\u2665', '\u2666', '\u2663'];

class Renderer {
  constructor(opts, ctx) {
    this.opts = opts; this.ctx = ctx;
    this.used = new Set();
    this.targets = new Map();  // normalized name -> { href } | { alias } | { refused }
    this.anonTargets = []; this.anonIdx = 0;
    this.footnotes = new Map(); this.autoFootnotes = []; this.autoIdx = 0; this.symbolIdx = 0; this.symbolNotes = [];
    this.subs = new Map();
    this.sections = [];
    this.curLine = null;
    this.mathCount = 0;
    this.images = 0;
  }

  warn(message, level = 2) { if (this.ctx.warnings.length >= 1000) return; const l = this.curLine; this.ctx.warnings.push({ line: l ? l.n : 0, file: l ? l.f : 0, message, level }); }

  // Pass 1: names, ids, footnote numbers, substitutions.
  collect(nodes) {
    const walk = (list) => {
      for (let k = 0; k < list.length; k++) {
        const n = list[k];
        this.curLine = n.line;
        switch (n.type) {
          case 'title': {
            const plain = plainTitle(n.text);
            n.id = makeId(plain, this.used);
            const key = normName(plain);
            if (!this.targets.has(key)) this.targets.set(key, { href: '#' + n.id, title: plain, implicit: true });
            this.sections.push({ title: plain, level: n.level, id: n.id, line: n.line.f === 0 ? n.line.n : -1 });
            break;
          }
          case 'target': {
            const chained = !n.url ? findAfter(list, k, x => x.type !== 'comment') : null;
            const chainUrl = chained && chained.type === 'target' && chained.url ? chained.url : '';
            if (n.anonymous) { this.anonTargets.push(n.url || chainUrl ? this.urlTarget(n.url || chainUrl) : { href: '#' + (n.id = makeId('anonymous', this.used)) }); break; }
            const key = normName(n.name);
            let t;
            if (!n.url && chainUrl && !/[^\\]_$/.test(chainUrl)) t = this.urlTarget(chainUrl);
            else if (!n.url) {
              n.id = makeId(n.name, this.used);
              // A target just before a title points at that section (Sphinx :ref: uses the title text).
              const next = findAfter(list, k, x => x.type !== 'target' && x.type !== 'comment');
              t = { href: '#' + n.id, title: next && next.type === 'title' ? plainTitle(next.text) : null };
              if (next && next.type === 'title') n.sectionTitle = next.text;
            } else if (/[^\\]_$/.test(n.url) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(n.url)) t = { alias: normName(n.url.slice(0, -1).replace(/^`|`$/g, '')) };
            else { t = this.urlTarget(n.url); if (t.href) (this.external = this.external || []).push({ name: n.name, href: t.href }); }
            const old = this.targets.get(key);
            if (old && !old.implicit && old.href !== t.href) this.warn(`Duplicate explicit target name: "${n.name}".`, 1);
            if (!old || old.implicit) this.targets.set(key, t);
            break;
          }
          case 'footnote': {
            const lab = n.label;
            if (lab === '*') { n.num = SYMBOLS[this.symbolNotes.length % 10].repeat(Math.floor(this.symbolNotes.length / 10) + 1); this.symbolNotes.push(n); }
            else if (lab.startsWith('#')) { n.auto = true; this.autoFootnotes.push(n); if (lab.length > 1) this.footnotes.set(normName(lab.slice(1)), n); }
            else { n.num = lab; this.footnotes.set(lab, n); }
            n.id = makeId('footnote-' + (lab.replace(/^#/, '') || 'auto'), this.used);
            if (/^#./.test(lab) && !this.targets.has(normName(lab.slice(1)))) this.targets.set(normName(lab.slice(1)), { href: '#' + n.id });
            break;
          }
          case 'citation': n.id = makeId(n.label, this.used); this.footnotes.set(normName(n.label), n); n.num = n.label; if (!this.targets.has(normName(n.label))) this.targets.set(normName(n.label), { href: '#' + n.id }); break;
          case 'contents': n.id = makeId(n.title, this.used); if (!this.targets.has(normName(n.title))) this.targets.set(normName(n.title), { href: '#' + n.id, title: n.title }); break;
          case 'substitution_def': this.subDef(n); break;
          default: break;
        }
        for (const key of ['children', 'legend']) if (Array.isArray(n[key])) walk(n[key]);
        if (n.items) for (const it of n.items) walk(it.children);
        if (n.rows) for (const r of n.rows) for (const c of r) walk(c.children);
      }
    };
    walk(nodes);
    // Document title and subtitle (docutils doctitle transform): a lone first top-level title, and a lone level-2
    // title right after it. Section numbers (sectnum) start below them.
    const skip = n => ['comment', 'target', 'substitution_def'].includes(n.type);
    const first = nodes.find(n => !skip(n));
    this.numBase = 0;
    if (first && first.type === 'title' && first.level === 1 && nodes.filter(n => n.type === 'title' && n.level === 1).length === 1) {
      this.numBase = 1;
      const next = nodes.slice(nodes.indexOf(first) + 1).find(n => !skip(n));
      if (next && next.type === 'title' && next.level === 2 && nodes.filter(n => n.type === 'title' && n.level === 2).length === 1) this.numBase = 2;
    }
    // Auto-numbered footnotes take the lowest numbers not used by manual ones.
    let next = 1;
    for (const f of this.autoFootnotes) { while (this.footnotes.has(String(next))) next++; f.num = String(next); this.footnotes.set(String(next), f); next++; }
    for (const [k, v] of this.ctx.subDefs) if (!this.subs.has(k)) this.subs.set(k, { html: esc(v.text) });
    this.inlineEmbedded(nodes);
  }

  // `text <url>`_ also defines the name "text" for other references in the document.
  inlineEmbedded(nodes) {
    const re = /`([^`<]*?)\s*<([^`<>]+)>`_(?!_)/g;
    const walk = list => { for (const n of list) {
      for (const key of ['text', 'term']) if (typeof n[key] === 'string' && n[key].includes('>`_')) {
        let m; re.lastIndex = 0;
        while ((m = re.exec(n[key]))) { const name = normName(m[1]); const u = m[2].trim(); if (name && !/_$/.test(u) && !this.targets.has(name)) this.targets.set(name, this.urlTarget(u.replace(/\s+/g, ''))); }
      }
      for (const key of ['children', 'legend']) if (Array.isArray(n[key])) walk(n[key]);
      if (n.items) for (const it of n.items) { if (typeof it.term === 'string') walk([{ text: it.term }]); walk(it.children); }
      if (n.rows) for (const r of n.rows) for (const c of r) walk(c.children);
    } };
    walk(nodes);
  }

  urlTarget(url) {
    const ok = safeHref(url);
    if (!ok) { this.warn(`Link target refused: "${String(url).slice(0, 80)}" (only http, https, mailto, ftp and relative links are allowed).`); return { refused: true }; }
    return { href: ok };
  }

  subDef(n) {
    const d = n.directive;
    const key = n.name;
    if (this.subs.has(key)) this.warn(`Duplicate substitution definition name: "${key}".`, 1);
    let html = '';
    switch (d.name) {
      case 'replace': html = this.inline(d.args + (d.content.length ? ' ' + d.content.map(x => x.t).join(' ') : '')); break;
      case 'unicode': html = esc(unicodeArg(d.args)); break;
      case 'date': html = esc(strftime(d.args || '%Y-%m-%d', new Date())); break;
      case 'image': html = this.imageHtml(d.args.replace(/\s+/g, ''), d.options, true); break;
      default: html = this.inline(d.args); this.warn(`Substitution "${key}" uses the "${d.name}" directive; only replace, unicode, date and image are supported.`, 1);
    }
    this.subs.set(key, { html });
  }

  /** Case-insensitive substitution name lookup through an index, rebuilt when definitions were added. */
  subKeyLower(name) {
    if (!this.subsLower || this.subsLowerSize !== this.subs.size) {
      this.subsLower = new Map();
      for (const k of this.subs.keys()) { const l = k.toLowerCase(); if (!this.subsLower.has(l)) this.subsLower.set(l, k); }
      this.subsLowerSize = this.subs.size;
    }
    return this.subsLower.get(String(name).toLowerCase());
  }

  resolveRef(name, depth = 0) {
    const t = this.targets.get(name);
    if (!t) return null;
    if (t.alias !== undefined) return depth > 10 ? null : this.resolveRef(t.alias, depth + 1);
    return t;
  }

  inline(text) {
    const self = this;
    return renderInline(text, {
      warn: m => self.warn(m),
      ref: name => self.resolveRef(name),
      anon: () => { const t = self.anonTargets[self.anonIdx++]; return t ? t.href || null : null; },
      sub: name => self.subs.get(name) || self.subs.get(self.subKeyLower(name)),
      footnoteRef: label => self.footnoteRef(label),
      targetId: name => { const id = makeId(name, self.used); if (!self.targets.has(name)) self.targets.set(name, { href: '#' + id }); return id; },
      role: (name, body) => self.role(name, body),
      defaultRole: self.ctx.defaultRole,
    });
  }

  footnoteRef(label) {
    let n;
    if (label === '#') { n = this.autoFootnotes.filter(f => f.label === '#')[this.autoIdx++]; }
    else if (label === '*') { n = this.symbolNotes[this.symbolIdx++]; }
    else if (label.startsWith('#')) n = this.footnotes.get(normName(label.slice(1)));
    else n = this.footnotes.get(label) || this.footnotes.get(normName(label));
    if (!n) return null;
    const refId = makeId('footnote-reference-' + (n.num || label), this.used);
    if (!n.backrefs) n.backrefs = [];
    n.backrefs.push(refId);
    return { href: '#' + n.id, text: n.num, id: refId, citation: n.type === 'citation' };
  }

  role(name, body) {
    const raw = body;
    const text = unescape(body);
    const custom = this.ctx.roles[name];
    if (custom) {
      const inner = custom.base ? this.role(custom.base, body) : esc(text);
      return `<span class="${esc(custom.cls)}">${inner}</span>`;
    }
    const titled = () => { const m = /^([\s\S]*?)\s*<([^<>]+)>$/.exec(text); return m ? { title: m[1].trim(), target: m[2].trim() } : { title: null, target: text.trim() }; };
    const bare = s => s.replace(/^[~!.]+/, '');
    switch (name) {
      case 'emphasis': case 'em': return `<em>${esc(text)}</em>`;
      case 'strong': return `<strong>${esc(text)}</strong>`;
      case 'literal': return `<code class="literal">${esc(raw.replace(/\\(.)/g, '$1'))}</code>`;
      case 'code': return `<code class="literal code">${esc(raw)}</code>`;
      case 'subscript': case 'sub': return `<sub>${esc(text)}</sub>`;
      case 'superscript': case 'sup': return `<sup>${esc(text)}</sup>`;
      case 'title-reference': case 'title': case 't': return `<cite>${esc(text)}</cite>`;
      case 'math': case 'eq': this.mathCount++; return `<span class="math" data-tex="${esc(raw)}">${esc(raw)}</span>`;
      case 'abbreviation': case 'abbr': { const { title, target } = titled(); return title === null ? `<abbr>${esc(text)}</abbr>` : `<abbr title="${esc(target)}">${esc(title)}</abbr>`; }
      case 'acronym': return `<abbr>${esc(text)}</abbr>`;
      case 'kbd': return text.split(/\s+|(?<=\S)(?=[-+])|(?<=[-+])(?=\S)/).filter(Boolean).map(k => /^[-+]$/.test(k) ? esc(k) : `<kbd>${esc(k)}</kbd>`).join('');
      case 'pep-reference': case 'pep': { const n = parseInt(text, 10); return Number.isFinite(n) ? `<a class="reference external" href="https://peps.python.org/pep-${String(n).padStart(4, '0')}/">PEP ${n}</a>` : esc(text); }
      case 'rfc-reference': case 'rfc': { const n = parseInt(text, 10); return Number.isFinite(n) ? `<a class="reference external" href="https://datatracker.ietf.org/doc/html/rfc${n}.html">RFC ${n}</a>` : esc(text); }
      case 'file': case 'samp': return `<code class="file">${esc(text).replace(/\{([^}]*)\}/g, '<em>$1</em>')}</code>`;
      case 'command': case 'program': case 'makevar': case 'mailheader': case 'regexp': case 'dfn': return name === 'dfn' ? `<dfn>${esc(text)}</dfn>` : `<strong class="${name}">${esc(text)}</strong>`;
      case 'guilabel': return `<span class="guilabel">${esc(text.replace(/&(?=\w)/, ''))}</span>`;
      case 'menuselection': return `<span class="menuselection">${esc(text.replace(/&(?=\w)/g, '')).replace(/--&gt;/g, '\u25b8')}</span>`;
      case 'raw-html': case 'raw': return sanitizeHtml(text, { resolveSrc: src => { const x = this.resolveImage(src); return x ? (x.src || x) : null; } }).html;
      case 'doc': {
        const { title, target } = titled();
        const href = safeHref(bare(target).replace(/\/$/, '') + (/\.\w+$/.test(target) ? '' : '.rst'));
        if (!href) return esc(title || target);
        return `<a class="reference internal doc" href="${esc(href)}" data-doc="1">${esc(title || target)}</a>`;
      }
      case 'ref': {
        const { title, target } = titled();
        const t = this.resolveRef(normName(target));
        const shown = title || (t && t.title) || target;
        if (t && t.href) return `<a class="reference internal" href="${esc(t.href)}">${esc(shown)}</a>`;
        return `<span class="xref std-ref" title="Sphinx cross-reference to &quot;${esc(target)}&quot; (defined in another file)">${esc(shown)}</span>`;
      }
      case 'download': { const { title, target } = titled(); const h = safeHref(target); return h ? `<a class="reference download" href="${esc(h)}"><code>${esc(title || target)}</code></a>` : esc(title || target); }
      case 'term': { const { title, target } = titled(); return `<span class="xref std-term">${esc(title || target)}</span>`; }
      case 'envvar': case 'option': case 'confval': return `<code class="xref">${esc(titled().title || titled().target)}</code>`;
      default: {
        // Sphinx domain roles (:py:func:, :class:, :c:macro: ...) and unknown roles: show the target as code,
        // never as an error. A title in "Title <target>" form is shown instead.
        const { title, target } = titled();
        const shown = title || (target.startsWith('~') ? target.slice(1).split('.').pop() : bare(target));
        const callable = /(^|:)(func|meth|function|method)$/.test(name) && !title && !/\)$/.test(shown);
        const known = /^(py|c|cpp|js|rst|std|math|mat|rb|php|go|java|ts|cs|f|http|cmake|bash)?:?(func|meth|class|mod|attr|data|exc|obj|const|any|type|member|macro|struct|union|enum|enumerator|var|expr|texpr|numref|eq|keyword|token|ref|doc|term|envvar|option|program|directive|role|setting|confval|event|issue|pr|gh|user|commit|mimetype|newsgroup|manpage|source|meta|attribute|function|method|module|exception|object|property|decorator|class-ref)$/.test(name);
        if (!known) this.warn(`Unknown interpreted text role "${name}" (shown as plain code).`, 1);
        return `<code class="xref ${esc(name.replace(/[^\w-]/g, '-'))}" title=":${esc(name)}: (resolved by Sphinx)">${esc(shown + (callable ? '()' : ''))}</code>`;
      }
    }
  }

  resolveImage(uri) {
    if (isDataImage(uri)) return uri;
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')) return null; // remote: never fetched
    return this.opts.resolveImage ? this.opts.resolveImage(uri, this.ctx.files[this.curLine ? this.curLine.f : 0]) : null;
  }

  imageHtml(uri, o, inline = false) {
    this.images++;
    const alt = o.alt || uri.split('/').pop();
    const attrs = [];
    const size = v => { const m = /^\s*([\d.]+)\s*(px|em|ex|%|pt|pc|cm|mm|in|vw|vh|rem)?\s*$/.exec(v || ''); return m ? m[1] + (m[2] || 'px') : null; };
    const st = [];
    if (size(o.width)) st.push(`width:${size(o.width)}`);
    if (size(o.height)) st.push(`height:${size(o.height)}`);
    if (o.scale && /^\d+%?$/.test(o.scale.trim()) && !st.length) attrs.push(`data-scale="${parseInt(o.scale, 10)}"`);
    const cls = ['image'];
    if (o.align && /^(left|center|right|top|middle|bottom)$/.test(o.align)) cls.push('align-' + o.align);
    if (o.class) cls.push(...o.class.split(/\s+/).map(c => c.replace(/[^\w-]/g, '')));
    const src = this.resolveImage(uri);
    let h;
    if (src) {
      h = `<img src="${esc(src.src || src)}"${src.path ? ` data-path="${esc(src.path)}"` : ''} alt="${esc(alt)}" class="${cls.join(' ')}"${st.length ? ` data-style="${esc(st.join(';'))}"` : ''} ${attrs.join(' ')} loading="lazy">`;
    } else {
      const remote = /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//');
      const why = remote ? 'Remote image, not loaded: the preview works offline.' : (this.opts.imageError ? this.opts.imageError(uri, this.ctx.files[this.curLine ? this.curLine.f : 0]) : 'Image not found.');
      if (!remote) this.warn(`Image not shown: ${uri.slice(0, 120)} (${why})`, 1);
      h = `<span class="image-missing${remote ? ' remote' : ''} ${cls.slice(1).join(' ')}" title="${esc(why + ' ' + uri)}">\u25a3 ${esc(alt)}</span>`;
    }
    if (o.target) {
      const r = /_$/.test(o.target) ? this.resolveRef(normName(o.target.slice(0, -1).replace(/^`|`$/g, ''))) : { href: safeHref(o.target) };
      if (r && r.href) h = `<a class="reference image-link" href="${esc(r.href)}">${h}</a>`;
    }
    return h;
  }

  // Pass 2: HTML. Each top-level node is one chunk, so the webview can replace only what changed.
  renderTop(nodes) {
    const chunks = [];
    for (const n of nodes) {
      const h = this.node(n, true);
      if (h) chunks.push(h);
    }
    return chunks;
  }

  attr(n, top) { return n.line && n.line.f === 0 ? ` data-line="${n.line.n}"` : ''; }

  nodes(list) { let h = ''; for (const n of list) h += this.node(n); return h; }

  node(n, top) {
    this.curLine = n.line;
    const a = this.attr(n);
    switch (n.type) {
      case 'paragraph': return `<p${a}${n.cls ? ` class="${n.cls}"` : ''}${n.problem ? ' class="problematic-block"' : ''}>${this.inline(n.text)}</p>\n`;
      case 'title': {
        const lv = Math.min(6, n.level);
        let num = '';
        const d = n.level - (this.numBase || 0);
        if (this.ctx.sectnum && d >= 1) { this.secNum = this.secNum || []; this.secNum.length = d; this.secNum[d - 1] = (this.secNum[d - 1] || 0) + 1; for (let k = 0; k < d - 1; k++) this.secNum[k] = this.secNum[k] || 1; num = `<span class="sectnum">${this.secNum.join('.')}</span> `; }
        return `<h${lv} id="${n.id}"${a}>${num}${this.inline(n.text)}<a class="headerlink" href="#${n.id}" title="Link to this heading">\u00b6</a></h${lv}>\n`;
      }
      case 'transition': return `<hr class="docutils"${a}>\n`;
      case 'literal': return this.literal(n, a);
      case 'doctest': return `<pre class="doctest-block"${a}><code>${this.highlight(n.text, 'python-repl') || esc(n.text)}</code></pre>\n`;
      case 'parsed_literal': return `<pre class="parsed-literal"${a}>${this.inline(n.text)}</pre>\n`;
      case 'bullet_list': return `<ul${a}${this.simple(n) ? ' class="simple"' : ''}>\n${n.items.map(it => this.item(it, this.simple(n))).join('')}</ul>\n`;
      case 'enum_list': {
        const t = { arabic: '1', loweralpha: 'a', upperalpha: 'A', lowerroman: 'i', upperroman: 'I' }[n.enumtype] || '1';
        return `<ol${a} type="${t}"${n.start !== 1 ? ` start="${n.start}"` : ''}${this.simple(n) ? ' class="simple"' : ''}>\n${n.items.map(it => this.item(it, this.simple(n))).join('')}</ol>\n`;
      }
      case 'def_list': return `<dl${a} class="definition-list">\n${n.items.map(it => { this.curLine = it.line; return `<dt${this.attr(it)}>${this.inline(it.term)}${it.classifiers.map(c => ` <span class="classifier-delimiter">:</span> <span class="classifier">${this.inline(c)}</span>`).join('')}</dt>\n<dd>${this.nodes(it.children)}</dd>\n`; }).join('')}</dl>\n`;
      case 'field_list': return `<dl${a} class="field-list">\n${n.items.map(it => { this.curLine = it.line; return `<dt${this.attr(it)}>${this.inline(it.name)}<span class="colon">:</span></dt>\n<dd>${this.compact(it.children)}</dd>\n`; }).join('')}</dl>\n`;
      case 'option_list': return `<dl${a} class="option-list">\n${n.items.map(it => `<dt${this.attr(it)}>${it.opts.map(o => `<kbd><span class="option">${esc(o)}</span></kbd>`).join(', ')}</dt>\n<dd>${this.compact(it.children)}</dd>\n`).join('')}</dl>\n`;
      case 'line_block': return `<div class="line-block"${a}>\n${n.lines.map(x => x.text ? `<div class="line"${x.indent ? ` style="margin-left:${Math.min(x.indent, 40)}ch"` : ''}>${this.inline(x.text)}</div>` : '<div class="line"><br></div>').join('\n')}\n</div>\n`.replace(/ style="margin-left:(\d+)ch"/g, ' data-indent="$1"');
      case 'blockquote': return `<blockquote${a}${n.cls ? ` class="${n.cls}"` : ''}>\n${this.nodes(n.children)}${n.attribution ? `<p class="attribution">\u2014 ${this.inline(n.attribution)}</p>\n` : ''}</blockquote>\n`;
      case 'table': return this.table(n, a);
      case 'admonition': return `<div class="admonition ${esc(n.kind)}${n.options && n.options.class ? ' ' + esc(n.options.class) : ''}"${a}>\n<p class="admonition-title">${n.inlineTitle ? this.inline(n.title) : esc(n.title)}</p>\n${this.nodes(n.children)}</div>\n`;
      case 'topic': return `<div class="topic${n.cls ? ' ' + n.cls : ''}"${a}>\n${n.title ? `<p class="topic-title">${this.inline(n.title)}</p>\n` : ''}${this.nodes(n.children)}</div>\n`;
      case 'sidebar': return `<aside class="sidebar"${a}>\n${n.title ? `<p class="sidebar-title">${this.inline(n.title)}</p>\n` : ''}${n.subtitle ? `<p class="sidebar-subtitle">${this.inline(n.subtitle)}</p>\n` : ''}${this.nodes(n.children)}</aside>\n`;
      case 'rubric': return `<p class="rubric"${a}>${this.inline(n.text)}</p>\n`;
      case 'container': return `<div class="container ${esc(String(n.cls || '').replace(/[^\w -]/g, ''))}"${a}>\n${this.nodes(n.children)}</div>\n`;
      case 'details': return `<details class="dropdown"${n.open ? ' open' : ''}${a}><summary>${this.inline(n.title)}</summary>\n${this.nodes(n.children)}</details>\n`;
      case 'version': {
        const label = { versionadded: 'Added in version', versionchanged: 'Changed in version', deprecated: 'Deprecated since version', versionremoved: 'Removed in version' }[n.kind];
        return `<div class="versionmodified ${n.kind}"${a}><p><span class="versionmodified-label">${label} ${esc(n.version)}${n.text ? ':' : '.'}</span> ${n.text ? this.inline(n.text) : ''}</p></div>\n`;
      }
      case 'math_block': {
        this.mathCount++;
        const parts = n.tex.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
        return `<div class="math-block"${a}${n.label ? ` id="${esc(makeId(n.label, this.used))}"` : ''}>${parts.map(p => `<div class="math display" data-tex="${esc(p)}">${esc(p)}</div>`).join('')}</div>\n`;
      }
      case 'image': return `<div class="image-wrap${n.options.align ? ' align-' + esc(n.options.align) : ''}"${a}>${this.imageHtml(n.uri, n.options)}</div>\n`;
      case 'figure': {
        const o = n.options;
        const fw = /^\s*([\d.]+)\s*(px|em|%)?\s*$/.exec(o.figwidth || '');
        return `<figure class="figure${o.align ? ' align-' + esc(o.align) : ''}"${a}${fw ? ` data-style="width:${fw[1]}${fw[2] || 'px'}"` : ''}>${this.imageHtml(n.uri, o)}${n.caption || n.legend.length ? `<figcaption>${n.caption ? `<p class="caption">${this.inline(n.caption.text)}</p>` : ''}${n.legend.length ? `<div class="legend">${this.nodes(n.legend)}</div>` : ''}</figcaption>` : ''}</figure>\n`;
      }
      case 'raw_html': {
        const r = sanitizeHtml(n.html, { resolveSrc: src => { const x = this.resolveImage(src); return x ? (x.src || x) : null; } });
        if (r.removed) this.warn(`raw html: ${r.removed} unsafe tag(s) or attribute(s) removed (scripts, event handlers, styles, frames and unsafe links are never shown).`, 1);
        return `<div class="raw-html"${a}>${r.html}</div>\n`;
      }
      case 'footnote': case 'citation': {
        const back = (n.backrefs || []);
        const label = n.type === 'citation' ? n.label : n.num;
        return `<aside class="${n.type}" id="${n.id}"${a}><span class="label"><span class="fn-bracket">[</span>${back.length === 1 ? `<a role="doc-backlink" href="#${back[0]}">${esc(label)}</a>` : esc(label)}<span class="fn-bracket">]</span></span>${back.length > 1 ? `<span class="backrefs">(${back.map((b, k) => `<a role="doc-backlink" href="#${b}">${k + 1}</a>`).join(',')})</span>` : ''}<div class="fn-body">${this.nodes(n.children)}</div></aside>\n`;
      }
      case 'target': return n.id ? `<span class="target" id="${n.id}"${a}></span>` : '';
      case 'contents': return this.contents(n, a);
      case 'target_notes': {
        const ext = this.external || [];
        if (!ext.length) return '';
        return `<div class="target-notes"${a}>${ext.map((t, k) => `<aside class="footnote"><span class="label"><span class="fn-bracket">[</span>${k + 1}<span class="fn-bracket">]</span></span><div class="fn-body"><p>${esc(t.name)}: <a class="reference external" href="${esc(t.href)}">${esc(t.href)}</a></p></div></aside>`).join('')}</div>\n`;
      }
      case 'toctree': return this.toctree(n, a);
      case 'sphinx_box': return `<div class="sphinx-box ${n.kind}"${a}><p class="sphinx-label"><span class="sphinx-tag">${n.kind === 'autodoc' ? 'Sphinx autodoc' : n.kind === 'diagram' ? 'Diagram' : 'Directive'}</span> <code>${esc(n.label)}</code></p>${n.note ? `<p class="sphinx-note">${esc(n.note)}</p>` : ''}${n.code ? `<pre><code>${esc(n.code)}</code></pre>` : ''}${n.children ? this.nodes(n.children) : ''}</div>\n`;
      case 'sig': return `<dl class="sig-object ${esc(n.kind)}${n.small ? ' small' : ''}"${a}><dt class="sig"><span class="sig-kind">${esc(n.kind)}</span> <code class="sig-name">${esc(n.sig)}</code></dt><dd>${this.nodes(n.children)}</dd></dl>\n`;
      case 'notice': return `<div class="system-message"${a}><span class="sm-label">Not shown</span> ${esc(n.text)}</div>\n`;
      case 'comment': case 'substitution_def': return '';
      default: return '';
    }
  }

  simple(n) { return n.items.every(it => it.children.length <= 1 || (it.children.length === 2 && it.children[0].type === 'paragraph' && /list$/.test(it.children[1].type))) && n.items.every(it => !it.children.length || it.children[0].type === 'paragraph' || /list$/.test(it.children[0].type)); }
  compact(children) { if (children.length === 1 && children[0].type === 'paragraph') { this.curLine = children[0].line; return this.inline(children[0].text); } return this.nodes(children); }
  item(it, simple) {
    this.curLine = it.line;
    const a = this.attr(it);
    if (simple && it.children[0] && it.children[0].type === 'paragraph') return `<li${a}>${this.inline(it.children[0].text)}${this.nodes(it.children.slice(1))}</li>\n`;
    return `<li${a}>${this.nodes(it.children)}</li>\n`;
  }

  highlight(code, lang) { if (!lang || !this.opts.highlight) return null; try { return this.opts.highlight(code, lang); } catch { return null; } }

  literal(n, a) {
    const o = n.options || {};
    const lang = (n.lang || '').toLowerCase();
    let body = this.highlight(n.text, lang) || esc(n.text);
    const lines = body.split('\n');
    const emph = new Set();
    if (o['emphasize-lines']) for (const p of String(o['emphasize-lines']).split(',')) { const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(p); if (m) for (let k = +m[1]; k <= +(m[2] || m[1]) && k <= lines.length; k++) emph.add(k); }
    if ('linenos' in o || 'number-lines' in o || emph.size) {
      const start = parseInt(o['lineno-start'] || o['number-lines'] || '1', 10) || 1;
      const showNum = 'linenos' in o || 'number-lines' in o;
      body = lines.map((ln, k) => `<span class="code-line${emph.has(k + 1) ? ' hll' : ''}">${showNum ? `<span class="linenos">${k + start}</span>` : ''}${ln}</span>`).join('\n');
    }
    const cap = o.caption || n.caption;
    const pre = `<pre class="literal-block${lang ? ' highlight lang-' + esc(lang.replace(/[^\w+-]/g, '')) : ''}${n.problem ? ' problematic-block' : ''}"${cap ? '' : a}><code${lang ? ` class="language-${esc(lang.replace(/[^\w+-]/g, ''))}"` : ''}>${body}</code></pre>\n`;
    if (cap) return `<div class="code-block-caption-wrap"${a}><div class="code-block-caption">${this.inline(cap)}</div>${pre}</div>\n`;
    return pre;
  }

  table(n, a) {
    const widths = n.widths && /^[\d ,]+$/.test(n.widths) ? n.widths.split(/[ ,]+/).filter(Boolean).map(Number) : null;
    const total = widths ? widths.reduce((x, y) => x + y, 0) : 0;
    const cg = widths && widths.length === n.colCount ? `<colgroup>${widths.map(w => `<col data-w="${Math.round(w / total * 1000) / 10}">`).join('')}</colgroup>` : '';
    const rowHtml = (r, head) => `<tr>${r.map(c => { const tag = head || (n.stub && c.col !== undefined ? c.col < n.stub : false) ? 'th' : 'td'; return `<${tag}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}>${this.compact(c.children)}</${tag}>`; }).join('')}</tr>\n`;
    const head = n.rows.slice(0, n.headRows), body = n.rows.slice(n.headRows);
    if (n.stub) for (const r of n.rows) r.forEach((c, k) => { if (c.col === undefined) c.col = k; });
    return `<div class="table-wrap"${a}><table class="docutils">${n.caption ? `<caption>${this.inline(n.caption)}</caption>` : ''}${cg}${head.length ? `<thead>\n${head.map(r => rowHtml(r, true)).join('')}</thead>` : ''}<tbody>\n${body.map(r => rowHtml(r, false)).join('')}</tbody></table></div>\n`;
  }

  contents(n, a) {
    const depth = parseInt(n.options.depth || '0', 10) || 99;
    let secs = this.sections;
    let base = 0;
    if ('local' in n.options) {
      // Sections after this directive, until one at the same or a higher level than the current section.
      const myLine = n.line.n;
      const cur = [...secs].filter(s => s.line >= 0 && s.line < myLine).pop();
      base = cur ? cur.level : 0;
      const after = secs.filter(s => s.line > myLine);
      const stop = after.findIndex(s => s.level <= base);
      secs = stop < 0 ? after : after.slice(0, stop);
    }
    secs = secs.filter(s => s.level - base <= depth && s.level > base);
    if (!secs.length) return `<nav class="contents topic" id="${n.id}"${a}><p class="topic-title">${this.inline(n.title)}</p></nav>\n`;
    let h = '', lvl = 0;
    const min = Math.min(...secs.map(s => s.level));
    for (const s of secs) {
      const L = Math.max(1, s.level - min + 1);
      if (L > lvl) { while (lvl < L) { h += '<ul>'; lvl++; } }
      else { h += '</li>'; while (lvl > L) { h += '</ul></li>'; lvl--; } }
      h += `<li><a class="reference internal" href="#${s.id}">${esc(s.title)}</a>`;
    }
    h += '</li>'; while (lvl > 1) { h += '</ul></li>'; lvl--; } h += '</ul>';
    return `<nav class="contents topic" id="${n.id}"${a}><p class="topic-title">${this.inline(n.title)}</p>${h}</nav>\n`;
  }

  toctree(n, a) {
    const o = n.options;
    const items = n.entries.map(e => {
      const m = /^(.*?)\s*<([^<>]+)>$/.exec(e);
      const title = m ? m[1] : null, target = m ? m[2] : e;
      if ('glob' in o && /[*?[]/.test(target)) return `<li><code>${esc(target)}</code> <span class="sphinx-note">(glob, matched by Sphinx)</span></li>`;
      if (/^https?:\/\//.test(target)) return `<li><a class="reference external" href="${esc(target)}">${esc(title || target)}</a></li>`;
      if (target === 'self') return `<li>${esc(title || 'This page')}</li>`;
      const href = target + (/\.\w+$/.test(target) ? '' : '.rst');
      return `<li><a class="reference internal doc" data-doc="1" href="${esc(href)}">${esc(title || target)}</a></li>`;
    });
    const hidden = 'hidden' in o;
    return `<div class="sphinx-box toctree${hidden ? ' hidden-toc' : ''}"${a}><p class="sphinx-label"><span class="sphinx-tag">toctree</span> ${o.caption ? esc(o.caption) : 'Table of contents'}${hidden ? ' <span class="sphinx-note">(hidden in the Sphinx output)</span>' : ''}${o.maxdepth ? ` <span class="sphinx-note">maxdepth ${esc(o.maxdepth)}</span>` : ''}</p><ul>${items.join('')}</ul></div>\n`;
  }
}

function unicodeArg(s) {
  return String(s).replace(/\s*\.\.\s.*$/, '').split(/\s+/).filter(Boolean).map(tok => {
    const m = /^(?:0x|x|\\x|U\+|u|\\u|&#x)([0-9a-f]+);?$/i.exec(tok);
    if (m) { const n = parseInt(m[1], 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    if (/^\d+$/.test(tok)) { const n = parseInt(tok, 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return tok;
  }).join('');
}
function strftime(fmt, d) {
  const p = (n, k = 2) => String(n).padStart(k, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return fmt.replace(/%([YmdHMSyBbAaj%])/g, (m, c) => ({ Y: d.getFullYear(), m: p(d.getMonth() + 1), d: p(d.getDate()), H: p(d.getHours()), M: p(d.getMinutes()), S: p(d.getSeconds()), y: p(d.getFullYear() % 100), B: months[d.getMonth()], b: months[d.getMonth()].slice(0, 3), A: days[d.getDay()], a: days[d.getDay()].slice(0, 3), j: p(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), 3), '%': '%' }[c]));
}

/**
 * Render an RST document.
 * opts: { fileName, fileKey, readFile(target, fromFile) -> {text, key, name, uri}|{error}, resolveImage(uri, fromFile) -> {src, path}|null,
 *         imageError(uri, fromFile) -> string, highlight(code, lang) -> html|null }
 * Returns { chunks: [html], sections: [{title, level, id, line}], warnings: [{line, file, message, level}], files, stats }.
 */
function renderRst(text, opts = {}) {
  const t0 = Date.now();
  const ctx = { warnings: [], styles: [], curLevel: -1, files: [{ key: opts.fileKey || 'main', name: opts.fileName || 'document', uri: opts.fileUri }], includeStack: [], highlightLang: '', defaultRole: '', roles: {}, subDefs: new Map(), sectnum: false };
  const p = new Parser(opts, ctx);
  const lines = toLines(text, 0);
  let nodes;
  try { nodes = p.parse(lines, 0, true); }
  catch (err) {
    if (err instanceof RangeError) { ctx.warnings.push({ line: 0, file: 0, message: 'The document is nested too deeply to render.', level: 3 }); nodes = [{ type: 'literal', text: String(text).slice(0, 200000), line: lines[0] }]; }
    else throw err;
  }
  const r = new Renderer(opts, ctx);
  r.collect(nodes);
  const chunks = r.renderTop(nodes);
  // Warnings from included files are reported on the include line of the main file.
  const warnings = ctx.warnings.map(w => (w.file && ctx.files[w.file] ? { ...w, line: ctx.files[w.file].at || 0, file: 0, message: `${ctx.files[w.file].name}:${w.line + 1}: ${w.message}` } : w));
  return {
    chunks, sections: r.sections, warnings, files: ctx.files, tree: opts.keepTree ? nodes : undefined,
    stats: { lines: lines.length, chunks: chunks.length, sections: r.sections.length, math: r.mathCount, images: r.images, ms: Date.now() - t0 },
    title: ctx.docTitle || (r.sections[0] ? r.sections[0].title : ''),
  };
}

/** Section titles only (for the Outline view): block parse, no inline rendering, no includes. */
function outlineSections(text) {
  const ctx = { warnings: [], styles: [], curLevel: -1, files: [{ key: 'main', name: 'document' }], includeStack: [], highlightLang: '', defaultRole: '', roles: {}, subDefs: new Map(), sectnum: false };
  const nodes = new Parser({}, ctx).parse(toLines(text, 0), 0, true);
  return nodes.filter(n => n.type === 'title' && n.line.f === 0).map(n => ({ title: plainTitle(n.text), level: n.level, line: n.line.n }));
}

module.exports = { renderRst, outlineSections, toLines, makeId, plainTitle, _test: { isAdorn, enumInfo, roman, unicodeArg, pickLines } };
