'use strict';
// Grid tables and simple tables, following the docutils table parsers: cells are found by walking the borders,
// so row and column spans work. Each cell keeps its text lines (with source line numbers); the caller parses
// them as body elements. Returns null (and a reason) when the table is malformed.

/**
 * lines: [{t, n, f}] of a grid table (each starts with '+' or '|').
 * Returns { rows: [[cell]], headRows, colCount } where cell = { lines, rowspan, colspan }.
 */
function parseGrid(lines) {
  const width = Math.max(...lines.map(l => l.t.trimEnd().length));
  const block = lines.map(l => l.t.trimEnd().padEnd(width, ' '));
  const bottom = block.length - 1, right = width - 1;
  if (block.length < 3 || !/^\+[-=+]+\+$/.test(block[0]) || !/^\+[-=+]+\+$/.test(block[bottom])) return { error: 'Malformed table: the first and last lines must be borders like +----+----+.' };
  let headSep = -1;
  for (let r = 1; r < bottom; r++) if (/^\+(=+\+)+$/.test(block[r])) { if (headSep >= 0) return { error: 'Malformed table: more than one header separator (+===+).' }; headSep = r; }
  const ch = (r, c) => (block[r] || '')[c] || ' ';
  const isH = c => c === '-' || c === '=';
  const cells = [];
  const done = new Set();
  const queue = [[0, 0]];
  const rowSeps = new Set([0]), colSeps = new Set([0]);
  let guard = 0;
  while (queue.length) {
    if (++guard > 200000) return { error: 'Malformed table: too many cells.' };
    queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [top, left] = queue.shift();
    const key = top + ',' + left;
    if (done.has(key) || top === bottom || left === right) continue;
    done.add(key);
    const cell = scanCell(top, left);
    if (!cell) continue;
    const [b, r] = cell;
    rowSeps.add(b); colSeps.add(r);
    cells.push({ top, left, bottom: b, right: r });
    if (!done.has(top + ',' + r)) queue.push([top, r]);
    if (!done.has(b + ',' + left)) queue.push([b, left]);
  }
  function scanCell(top, left) {
    if (ch(top, left) !== '+') return null;
    for (let c = left + 1; c <= right; c++) {
      const x = ch(top, c);
      if (x === '+') { const d = scanDown(top, left, c); if (d !== null) return [d, c]; }
      else if (!isH(x)) return null;
    }
    return null;
  }
  function scanDown(top, left, r) {
    for (let row = top + 1; row <= bottom; row++) {
      const x = ch(row, r);
      if (x === '+') { if (scanLeft(top, left, row, r)) return row; }
      else if (x !== '|') return null;
    }
    return null;
  }
  function scanLeft(top, left, b, r) {
    for (let c = r - 1; c > left; c--) { const x = ch(b, c); if (x !== '+' && !isH(x)) return false; }
    if (ch(b, left) !== '+') return false;
    for (let row = b - 1; row > top; row--) { const x = ch(row, left); if (x !== '+' && x !== '|') return false; }
    return true;
  }
  if (!cells.length) return { error: 'Malformed table: no cells found.' };
  // Every inner character must belong to exactly one cell, or the borders do not line up.
  let area = 0;
  for (const c of cells) area += (c.bottom - c.top) * (c.right - c.left);
  if (area !== bottom * right) return { error: 'Malformed table: the borders do not line up (check the + corners and | edges).' };
  const rs = [...rowSeps].sort((a, b) => a - b), cs = [...colSeps].sort((a, b) => a - b);
  const rowIdx = new Map(rs.map((v, i) => [v, i])), colIdx = new Map(cs.map((v, i) => [v, i]));
  const nRows = rs.length - 1;
  const rows = Array.from({ length: nRows }, () => []);
  for (const c of cells.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const ri = rowIdx.get(c.top), ci = colIdx.get(c.left);
    const body = [];
    for (let r = c.top + 1; r < c.bottom; r++) {
      const src = lines[r];
      body.push({ t: block[r].slice(c.left + 1, c.right).trimEnd(), n: src.n, f: src.f });
    }
    rows[ri].push({ lines: dedentCell(body), rowspan: rowIdx.get(c.bottom) - ri, colspan: colIdx.get(c.right) - ci, col: ci });
  }
  const headRows = headSep < 0 ? 0 : rowIdx.get(headSep) || 0;
  return { rows, headRows, colCount: cs.length - 1 };
}

function dedentCell(ls) {
  let k = Infinity;
  for (const l of ls) if (l.t.trim()) k = Math.min(k, l.t.length - l.t.trimStart().length);
  if (k === Infinity) k = 0;
  const out = ls.map(l => ({ t: l.t.trim() ? l.t.slice(k) : '', n: l.n, f: l.f }));
  while (out.length && !out[0].t) out.shift();
  while (out.length && !out[out.length - 1].t) out.pop();
  return out;
}

const SIMPLE_BORDER = /^=+( +=+)+ *$/;
const isBorder = t => /^=+( +=+)* *$/.test(t);

/** Finds the end (exclusive) of a simple table that starts at lines[i]. */
function simpleTableEnd(lines, i) {
  let borders = 1;
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].t;
    if (isBorder(t) && t.trim()) {
      borders++;
      const next = lines[j + 1];
      if (!next || !next.t.trim()) return j + 1;
      if (borders >= 3) return j + 1;
    }
  }
  return -1;
}

/** lines: from the top border to the bottom border. Returns { rows, headRows, colCount } or { error }. */
function parseSimple(lines) {
  const top = lines[0].t;
  const cols = [];
  const re = /=+/g; let m;
  while ((m = re.exec(top))) cols.push([m.index, m.index + m[0].length]);
  if (cols.length < 2) return { error: 'Malformed table: a simple table needs at least 2 columns.' };
  const inner = lines.slice(1, -1);
  // Text in the gap between two columns is an error in docutils ("Text in column margin").
  for (let k = 0; k < inner.length; k++) {
    const t = inner[k].t;
    if (!t.trim() || isBorder(t) || /^[-\s]+$/.test(t)) continue;
    const nx = inner[k + 1];
    // A row followed by a dash line spans columns: only the gaps that the dashes leave open must be empty.
    const span = nx && /-/.test(nx.t) && /^[-\s]+$/.test(nx.t) ? nx.t : null;
    for (let c = 0; c < cols.length - 1; c++) {
      if (span && span.slice(cols[c][1], cols[c + 1][0]).includes('-')) continue;
      const gap = t.slice(cols[c][1], cols[c + 1][0]);
      if (gap.trim()) return { error: `Malformed table: text in column margin in table line ${k + 2}.` };
    }
  }
  let headEnd = -1;
  inner.forEach((l, k) => { if (isBorder(l.t) && l.t.trim()) headEnd = k; });
  const rows = [];
  let cur = null, headRows = 0;
  const flush = () => { if (cur) { rows.push(cur); cur = null; } };
  for (let k = 0; k < inner.length; k++) {
    const l = inner[k];
    if (k === headEnd) { flush(); headRows = rows.length; continue; }
    if (!l.t.trim()) { flush(); continue; }
    if (/^[-\s]+$/.test(l.t) && /-/.test(l.t) && cur) {
      // A column span line under a row: re-split that row with the dash segments.
      const segs = []; const d = /-+/g; let x;
      while ((x = d.exec(l.t))) segs.push([x.index, x.index + x[0].length]);
      cur.spans = segs.map(([a, b]) => cols.filter(c => c[0] >= a - 1 && c[1] <= b + 1).length || 1);
      flush();
      continue;
    }
    const first = l.t.slice(cols[0][0], cols[1][0]).trim();
    if (!cur || first) { flush(); cur = { raw: [] }; }
    cur.raw.push(l);
  }
  flush();
  const out = rows.map(r => {
    const spans = r.spans && r.spans.reduce((a, b) => a + b, 0) === cols.length ? r.spans : cols.map(() => 1);
    const cells = [];
    let c = 0;
    for (const sp of spans) {
      const start = cols[c][0];
      const last = c + sp - 1;
      const end = last === cols.length - 1 ? Infinity : cols[last + 1][0];
      const ls = r.raw.map(l => ({ t: l.t.slice(start, end === Infinity ? undefined : end).trimEnd(), n: l.n, f: l.f }));
      cells.push({ lines: dedentCell(ls), rowspan: 1, colspan: sp, col: c });
      c += sp;
    }
    return cells;
  });
  return { rows: out, headRows, colCount: cols.length };
}

/** CSV with a delimiter and quote char; doubled quotes are an escaped quote. Returns rows of strings. */
function parseCsv(text, delim = ',', quote = '"', escape = null, keepSpace = false) {
  const rows = [];
  let row = [], cell = '', i = 0, inQ = false, quoted = false;
  const s = String(text);
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (escape && c === escape && s[i + 1] === quote) { cell += quote; i += 2; continue; }
      if (c === quote) { if (s[i + 1] === quote) { cell += quote; i += 2; continue; } inQ = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === quote && !cell.trim()) { inQ = true; quoted = true; cell = ''; i++; continue; }
    if (c === delim) { row.push(keepSpace || quoted ? cell : cell.trim()); cell = ''; quoted = false; i++; if (!keepSpace) while (s[i] === ' ') i++; continue; }
    if (c === '\n') { row.push(keepSpace || quoted ? cell : cell.trim()); rows.push(row); row = []; cell = ''; quoted = false; i++; continue; }
    cell += c; i++;
  }
  if (cell || row.length || quoted) { row.push(keepSpace || quoted ? cell : cell.trim()); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

module.exports = { parseGrid, parseSimple, simpleTableEnd, parseCsv, SIMPLE_BORDER };
