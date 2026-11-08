'use strict';
// VER11 red-team fixes: include budget, linear id/target/substitution handling, :doc: link check, raw role images, name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { renderRst } = require('../src/core/rst');
const html = r => r.chunks.join('');
const timed = (fn) => { const t0 = Date.now(); const r = fn(); return [r, Date.now() - t0]; };

test('includes share one budget per render: 1,000 includes of a 1 MB file do not fill memory', () => {
  const big = 'line of text\n'.repeat(80000); // about 1 MB
  let reads = 0;
  const readFile = (target) => { reads++; return { text: big, key: 'k-' + target, name: target, uri: 'file:///w/' + target }; };
  const src = 'T\n=\n\n' + Array.from({ length: 1000 }, (_, i) => `.. literalinclude:: f${i}.txt\n`).join('\n');
  const [r, ms] = timed(() => renderRst(src, { readFile }));
  assert.ok(reads <= 201, `reads ${reads}`);
  assert.ok(html(r).length < 80 * 1024 * 1024, `html ${html(r).length}`);
  assert.ok(r.warnings.some(w => /Includes stopped/.test(w.message)), 'a warning says the includes stopped');
  assert.ok(ms < 20000, ms + ' ms');
});

test('an include fan-out (each file includes the next one 20 times) stops at the budget', () => {
  const files = {};
  for (let d = 0; d < 5; d++) files[`l${d}.rst`] = Array.from({ length: 20 }, () => `.. include:: l${d + 1}.rst\n`).join('\n');
  files['l5.rst'] = 'leaf text\n';
  const readFile = (t) => (files[t] !== undefined ? { text: files[t], key: t, name: t, uri: 'file:///w/' + t } : { error: 'not found' });
  const [, ms] = timed(() => renderRst('.. include:: l0.rst\n', { readFile }));
  assert.ok(ms < 3000, ms + ' ms');
});

test(':lines: cannot repeat a file without end', () => {
  const readFile = (t) => ({ text: 'a\nb\nc\n', key: t, name: t, uri: 'file:///w/' + t });
  const r = renderRst('.. literalinclude:: x.txt\n   :lines: ' + Array(5000).fill('1-99999').join(',') + '\n', { readFile });
  assert.ok((html(r).match(/\bb\b/g) || []).length < 20);
});

test('64,000 sections with the same title render in seconds, ids stay unique and in docutils order', () => {
  const [r, ms] = timed(() => renderRst('A\n=\n\nx\n\n'.repeat(64000)));
  assert.ok(ms < 15000, ms + ' ms');
  const h = html(r);
  assert.ok(h.includes('id="a"') && h.includes('id="a-1"') && h.includes('id="a-2"') && h.includes('id="a-63999"'));
  const small = html(renderRst('A\n=\n\nx\n\nA 1\n===\n\ny\n\nA\n=\n\nz\n'));
  assert.ok(small.includes('id="a"') && small.includes('id="a-1"') && small.includes('id="a-2"'), small.slice(0, 300));
});

test('many targets and many unknown substitutions stay fast', () => {
  const t1 = 'T\n=\n\n' + Array.from({ length: 30000 }, (_, i) => `.. _t${i}:\n`).join('\n') + '\ntext\n';
  const [, ms1] = timed(() => renderRst(t1));
  assert.ok(ms1 < 8000, 'targets ' + ms1 + ' ms');
  const t2 = Array.from({ length: 6000 }, (_, i) => `.. |s${i}| replace:: v${i}\n`).join('') + '\n' + '|Q| '.repeat(6000) + '\n';
  const [, ms2] = timed(() => renderRst(t2));
  assert.ok(ms2 < 4000, 'subs ' + ms2 + ' ms');
  assert.ok(html(renderRst('.. |Ab| replace:: yes\n\n|ab|\n')).includes('yes'), 'case-insensitive substitution still works');
});

test(':doc: links go through the URL check; the raw role shows local images', () => {
  const h = html(renderRst(':doc:`javascript:alert(1)//x.js` and :doc:`guide/intro`\n'));
  assert.doesNotMatch(h, /href="javascript:/i);
  assert.match(h, /href="guide\/intro\.rst"/);
  const r = renderRst('.. role:: raw-html(raw)\n   :format: html\n\n:raw-html:`<img src="a.png">`\n', { resolveImage: () => ({ src: 'data:image/png;base64,AA==', path: '/w/a.png' }) });
  assert.doesNotMatch(html(r), /\[object Object\]/);
});

test('Marketplace name zovo-rst-preview (rst-preview belongs to another publisher) and ids match', () => {
  const root = path.join(__dirname, '..');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'zovo-rst-preview');
  const src = fs.readFileSync(path.join(root, 'src/extension.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/support.js'), 'utf8');
  assert.match(src, /'zovo\.zovo-rst-preview'/);
  assert.doesNotMatch(src, /zovo\.rst-preview\b/);
});

test('deep indentation stays fast: 1,500 nested list levels (2 MB of indent) render in seconds, not minutes', () => {
  const n = 1500;
  const src = 'D\n=\n\n' + Array.from({ length: n }, (_, i) => '  '.repeat(i) + '- item ' + i + '\n\n').join('');
  const [r, ms] = timed(() => renderRst(src));
  assert.ok(ms < 3000, ms + ' ms');
  assert.ok(r.warnings.some(w => /Nesting deeper than/.test(w.message)));
});

test('rating: an empty document is not a success, a file too large to render is a failure (VER11)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8');
  assert.match(src, /this\.lastEmpty = !text\.trim\(\);/);
  assert.match(src, /m\.version === this\.version && !this\.lastEmpty\) \{ this\.counted = true; rating\.success\(\); \}/);
  assert.match(src, /type: 'tooLarge'[^\n]*\n\s*if \(!this\.counted\) \{ this\.counted = true; rating\.failure\(\); \}/);
});
