// Compares element counts of RST Preview's HTML with the docutils doctree (scripts/ref_rst.py). Dev and gate tool.
// usage: node scripts/compare.js <file.rst>...
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { renderRst } = require('../src/core/rst');
const count = (h, re) => (h.match(re) || []).length;
function ours(file) {
  const r = renderRst(fs.readFileSync(file, 'utf8'), { fileName: path.basename(file), keepTree: true, resolveImage: u => ({ src: u }) });
  const h = r.chunks.join('');
  const c = { section: r.sections.length, paragraph: 0, bullet_list: 0, enumerated_list: 0, list_item: 0, definition_list_item: 0, field: 0, option_list_item: 0,
    literal_block: 0, doctest_block: 0, table: 0, entry: 0, footnote: 0, citation: 0, block_quote: 0, line: 0, transition: 0, admonition: 0, target: 0,
    reference: count(h, /<a class="(reference|footnote-reference|citation-reference)/g), emphasis: count(h, /<em>/g), strong: count(h, /<strong>/g),
    literal: count(h, /<code class="literal/g), image: count(h, /<img /g) + count(h, /class="image-missing/g), title_reference: count(h, /<cite>/g) };
  const map = { paragraph: 'paragraph', bullet_list: 'bullet_list', enum_list: 'enumerated_list', literal: 'literal_block', doctest: 'doctest_block', table: 'table', footnote: 'footnote', citation: 'citation', blockquote: 'block_quote', transition: 'transition', target: 'target' };
  const walk = list => { for (const n of list) {
    if (map[n.type]) c[map[n.type]]++;
    if (n.type === 'admonition') c.admonition++;
    if (n.type === 'line_block') c.line += n.lines.length;
    if (n.type === 'def_list') c.definition_list_item += n.items.length;
    if (n.type === 'field_list') c.field += n.items.length;
    if (n.type === 'option_list') c.option_list_item += n.items.length;
    if (n.type === 'bullet_list' || n.type === 'enum_list') c.list_item += n.items.length;
    if (n.type === 'table') for (const r of n.rows) c.entry += r.length;
    if (n.type === 'figure' && n.caption) c.paragraph++;
    for (const k of ['children', 'legend']) if (Array.isArray(n[k])) walk(n[k]);
    if (n.items) for (const it of n.items) walk(it.children);
    if (n.rows) for (const r of n.rows) for (const x of r) walk(x.children);
  } };
  walk(r.tree);
  // the contents directive adds lists, items and references in docutils too
  c.bullet_list += count(h, /<nav class="contents[^]*?<\/nav>/g) ? count((h.match(/<nav class="contents[^]*?<\/nav>/g) || []).join(''), /<ul>/g) : 0;
  c.list_item += count((h.match(/<nav class="contents[^]*?<\/nav>/g) || []).join(''), /<li>/g);
  return { r, c };
}
for (const f of process.argv.slice(2)) {
  const ref = JSON.parse(execFileSync('python3', ['-E', path.join(__dirname, 'ref_rst.py'), f], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const { r, c } = ours(f);
  const rc = ref.counts; rc.admonition = ['note','warning','tip','important','caution','danger','attention','hint','error','admonition'].reduce((a, k) => a + (rc[k] || 0), 0);
  const keys = Object.keys(c);
  const rows = keys.map(k => [k, rc[k] || 0, c[k], (rc[k] || 0) === c[k] ? '' : '  <-- diff']);
  console.log('==', path.basename(f), 'docutils messages', ref.messages.length, 'ours', r.warnings.length);
  for (const x of rows) if (x[3]) console.log('  ', x.join(' '));
  if (process.env.V) { for (const m of ref.messages) console.log('   du', m.line, m.text.slice(0, 100).replace(/\n/g, ' ')); for (const w of r.warnings) console.log('   us', w.line + 1, w.message.slice(0, 100)); }
}
