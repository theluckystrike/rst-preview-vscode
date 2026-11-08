'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderRst, outlineSections } = require('../src/core/rst');
const { sanitizeHtml, safeHref } = require('../src/core/sanitize');
const { resolveLocal } = require('../src/core/paths');
const { highlight } = require('../src/highlight');

const R = (text, opts = {}) => renderRst(text, { highlight, ...opts });
const H = (text, opts) => R(text, opts).chunks.join('');
const SAMPLES = path.join(__dirname, '..', 'samples');

test('section titles: underline and overline styles set the levels in order of appearance', () => {
  const r = R('=====\nTitle\n=====\n\nSub\n---\n\nSubsub\n~~~~~~\n\nSub 2\n-----\n');
  assert.deepEqual(r.sections.map(s => [s.title, s.level]), [['Title', 1], ['Sub', 2], ['Subsub', 3], ['Sub 2', 2]]);
  const h = r.chunks.join('');
  assert.match(h, /<h1 id="title" data-line="0">Title/); // the overline line, so scroll sync shows the whole title
  assert.match(h, /<h3 id="subsub"/);
});

test('a short underline is a warning but still a title; a 2-char one under long text is a paragraph', () => {
  const r = R('A long title\n=====\n\nText\n');
  assert.equal(r.sections.length, 1);
  assert.equal(r.warnings[0].message, 'Title underline too short.');
  assert.equal(r.warnings[0].line, 1);
  assert.equal(R('Some long words\n--\n').sections.length, 0);
});

test('bullet lists show bullets, nested lists and multi-paragraph items', () => {
  const h = H('- one\n- two\n\n  - nested a\n  - nested b\n\n- three\n\n  second paragraph\n');
  assert.equal((h.match(/<ul/g) || []).length, 2);
  assert.equal((h.match(/<li/g) || []).length, 5);
  assert.match(h, /<p data-line="8">second paragraph<\/p>/);
});

test('enumerated lists: arabic, alpha, roman, auto and start values; "A. Einstein" stays a paragraph', () => {
  assert.match(H('3. three\n4. four\n'), /<ol data-line="0" type="1" start="3"/);
  assert.match(H('a) first\nb) second\n'), /type="a"/);
  assert.match(H('i. one\nii. two\niii. three\n'), /type="i"/);
  assert.match(H('IV. four\nV. five\n'), /type="I" start="4"/);
  assert.equal((H('#. auto\n#. auto\n').match(/<li/g) || []).length, 2);
  assert.match(H('A. Einstein was a really\nsmart dude.\n'), /^<p/);
});

test('definition, field and option lists', () => {
  const h = H('term : classifier\n   Definition.\n\n:Author: Me\n:Version: 1.0\n\n-a         all\n--verbose  say more\n-o FILE    output\n');
  assert.match(h, /<dl data-line="0" class="definition-list">/);
  assert.match(h, /<span class="classifier">classifier<\/span>/);
  assert.match(h, /<dl data-line="3" class="field-list">/);
  assert.match(h, /<dt data-line="4">Version<span class="colon">/);
  assert.match(h, /class="option-list"/);
  assert.match(h, /<span class="option">-o FILE<\/span>/);
});

test('literal blocks: "::" forms, quoted literal, doctest, line block, block quote with attribution', () => {
  const h = H('Paragraph::\n\n   code here\n\nExpanded ::\n\n   more\n\n::\n\n   only code\n\n>>> 1 + 1\n2\n\n| line one\n|    indented\n\nQuote:\n\n   Wise words.\n\n   -- Someone\n');
  assert.match(h, /<p data-line="0">Paragraph:<\/p>/);
  assert.match(h, /<p data-line="4">Expanded<\/p>/);
  assert.equal((h.match(/<pre class="literal-block"/g) || []).length, 3);
  assert.match(h, /doctest-block/);
  assert.match(h, /<div class="line" data-indent="3">indented<\/div>/);
  assert.match(h, /<p class="attribution">— Someone<\/p>/);
});

test('inline markup: emphasis, strong, literal, roles, escapes, and the recognition rules', () => {
  const h = H('*em* **strong** ``lit`` `cite` :sub:`2` :sup:`3` :code:`x = 1` \\*not em\\* 2*3*4 (*) "*" a*b*c\n');
  assert.match(h, /<em>em<\/em>/);
  assert.match(h, /<strong>strong<\/strong>/);
  assert.match(h, /<code class="literal">lit<\/code>/);
  assert.match(h, /<cite>cite<\/cite>/);
  assert.match(h, /<sub>2<\/sub>/);
  assert.match(h, /\*not em\*/);
  assert.match(h, /2\*3\*4 \(\*\) &quot;\*&quot; a\*b\*c/);
});

test('hyperlinks: embedded, named (defined later), anonymous, chained, section and standalone', () => {
  const h = H('See `Docs <https://docs.example.org>`_, Python_, `the site`__, chained_, Intro_ and https://x.org/a.\n\n'
    + 'Intro\n=====\n\n.. _Python: https://www.python.org\n__ https://anon.example.org\n.. _chained:\n.. _target2: https://chain.example.org\n');
  assert.match(h, /<a class="reference external" href="https:\/\/docs.example.org">Docs<\/a>/);
  assert.match(h, /href="https:\/\/www.python.org">Python<\/a>/);
  assert.match(h, /href="https:\/\/anon.example.org">the site<\/a>/);
  assert.match(h, /href="https:\/\/chain.example.org">chained<\/a>/);
  assert.match(h, /href="#intro">Intro<\/a>/);
  assert.match(h, /href="https:\/\/x.org\/a">https:\/\/x.org\/a<\/a>\./);
});

test('unknown target is a warning on the right line and shown as problematic text', () => {
  const r = R('Title\n=====\n\nLine with nowhere_ link.\n');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].line, 3);
  assert.match(r.chunks.join(''), /class="problematic"/);
});

test('footnotes (manual, auto, labelled, symbol) and citations with backlinks', () => {
  const h = H('A [1]_ B [#]_ C [#note]_ D [*]_ E [CIT2002]_ F [#note]_\n\n.. [1] Manual.\n.. [#] Auto.\n.. [#note] Labelled.\n.. [*] Symbol.\n.. [CIT2002] Citation.\n');
  assert.match(h, /class="footnote-reference" href="#footnote-1"[^>]*>\[1\]/);
  assert.match(h, />\[2\]<\/a> C/);
  assert.match(h, />\[3\]<\/a> D/);
  assert.match(h, />\[\*\]<\/a> E/);
  assert.match(h, /class="citation-reference" href="#cit2002"/);
  assert.match(h, /<aside class="footnote" id="footnote-note"/);
  assert.match(h, /class="backrefs">\(<a role="doc-backlink"/);
});

test('substitutions: replace, unicode, image (local) and an undefined one', () => {
  const r = R('|name| is |tm| and |pic|. |nope|\n\n.. |name| replace:: *RST Preview*\n.. |tm| unicode:: U+2122\n.. |pic| image:: pic.png\n',
    { resolveImage: u => ({ src: 'vscode-resource:/' + u, path: '/w/' + u }) });
  const h = r.chunks.join('');
  assert.match(h, /<em>RST Preview<\/em> is ™ and <img src="vscode-resource:\/pic.png"/);
  assert.match(h, /class="problematic" title="Undefined substitution">\|nope\|/);
  assert.equal(r.warnings.length, 1);
});

test('grid table with a header, row span and column span', () => {
  const h = H(fs.readFileSync(path.join(SAMPLES, 'grid-tables.rst'), 'utf8'));
  assert.match(h, /<th>Header 1<\/th><th>Header 2<\/th><th>Header 3<\/th>/);
  assert.match(h, /<td colspan="2">Cells may span columns.<\/td>/);
  assert.match(h, /<td rowspan="2">Cells may\nspan rows.<\/td>/);
  assert.match(h, /<td rowspan="2"><ul/);
  assert.match(h, /<th colspan="2">Inputs<\/th>/);
  assert.match(h, /<caption>Frozen delights<\/caption>/);
  assert.match(h, /<td>San Francisco, CA<\/td>/);
  assert.match(h, /Malformed|literal-block problematic-block/);
});

test('admonitions: all nine kinds, generic admonition, nested code', () => {
  const h = H(fs.readFileSync(path.join(SAMPLES, 'admonitions.rst'), 'utf8'));
  for (const k of ['note', 'tip', 'hint', 'important', 'warning', 'caution', 'attention', 'danger', 'error']) assert.match(h, new RegExp(`class="admonition ${k}"`));
  assert.match(h, /<p class="admonition-title">A custom title<\/p>/);
  assert.match(h, /class="hljs-built_in">print/);
});

test('code blocks are highlighted, with caption and emphasized lines', () => {
  const h = H(fs.readFileSync(path.join(SAMPLES, 'readme-github.rst'), 'utf8'));
  assert.match(h, /<div class="code-block-caption">read_station.py<\/div>/);
  assert.match(h, /class="code-line hll"/);
  assert.match(h, /<span class="hljs-keyword">from<\/span>/);
  assert.match(h, /class="image-missing remote/); // badges are never fetched
});

test('math: role and directive become KaTeX placeholders; the label becomes an id', () => {
  const h = H(fs.readFileSync(path.join(SAMPLES, 'math.rst'), 'utf8'));
  assert.equal((h.match(/class="math"/g) || []).length, 3);
  assert.equal((h.match(/class="math display"/g) || []).length, 3);
  assert.match(h, /id="euler"/);
});

test('Sphinx directives and roles render as boxes and links, never as errors', () => {
  const r = R(fs.readFileSync(path.join(SAMPLES, 'sphinx-api.rst'), 'utf8'));
  const h = r.chunks.join('');
  assert.match(h, /class="sphinx-box toctree"/);
  assert.match(h, /href="install.rst" data-doc="1"/);
  assert.match(h, /class="sphinx-box autodoc"/);
  assert.match(h, /class="sig-object function"/);
  assert.match(h, /Added in version 0.4/);
  assert.match(h, /href="#api-reference">API reference<\/a>/);
  assert.match(h, /<code class="xref py-class"[^>]*>tidewater.Station<\/code>/);
  assert.match(h, /<code class="xref func"[^>]*>read\(\)<\/code>/);
  assert.match(h, /<kbd>Ctrl<\/kbd>\+<kbd>C<\/kbd>/);
  assert.equal(r.warnings.filter(w => w.level >= 2).length, 0, JSON.stringify(r.warnings));
});

test('contents directive lists the sections, local contents only the subsections', () => {
  const h = H('Top\n===\n\n.. contents:: Index\n\nA\n-\n\n.. contents:: :local:\n\nA1\n~~\n\nB\n-\n');
  assert.match(h, /<nav class="contents topic" id="index"/);
  const navs = h.match(/<nav[^]*?<\/nav>/g);
  assert.equal((navs[0].match(/<li>/g) || []).length, 4);
  assert.equal((navs[1].match(/<li>/g) || []).length, 1);
});

test('include: nested files, literalinclude lines, csv-table :file:, depth limit and cycle stop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstp-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.rst'), 'From A\n\n.. include:: b.rst\n');
    fs.writeFileSync(path.join(dir, 'b.rst'), 'From B\n\n.. include:: a.rst\n');
    fs.writeFileSync(path.join(dir, 'c.py'), 'one\ntwo\nthree\n');
    for (let k = 0; k < 8; k++) fs.writeFileSync(path.join(dir, `d${k}.rst`), `depth ${k}\n\n.. include:: d${k + 1}.rst\n`);
    fs.writeFileSync(path.join(dir, 'd8.rst'), 'bottom\n');
    const main = path.join(dir, 'main.rst');
    const readFile = (t, from) => { const r = resolveLocal(t, from && from.uri ? from.uri : main, dir); if (r.error) return { error: r.error }; return { text: fs.readFileSync(r.file, 'utf8'), key: r.file, name: path.basename(r.file), uri: r.file }; };
    const r = R('.. include:: a.rst\n\n.. literalinclude:: c.py\n   :lines: 2-3\n\n.. include:: d0.rst\n\n.. include:: /etc/passwd\n\n.. include:: ../../../../../../etc/passwd\n', { readFile, fileUri: main, fileKey: main });
    const h = r.chunks.join('');
    assert.match(h, /From A/);
    assert.match(h, /From B/);
    assert.match(h, /Include cycle stopped: a.rst/);
    assert.match(h, /two\nthree<\/code>/);
    assert.match(h, /depth 4/);
    assert.doesNotMatch(h, /<p[^>]*>depth 5<\/p>|bottom/);
    assert.match(h, /Include stopped at depth 5/);
    assert.doesNotMatch(h, /root:|nobody/);
    assert.ok(r.warnings.some(w => /outside the workspace folder/.test(w.message)));
    assert.ok(r.warnings.every(w => w.file === 0)); // warnings from included files point at the include line
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveLocal never leaves the root folder (.., absolute, symlink, scheme)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstp-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rstp-out-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.rst'), 'x');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
    const from = path.join(dir, 'main.rst');
    assert.ok(resolveLocal('ok.rst', from, dir).file);
    assert.match(resolveLocal('../' + path.basename(outside) + '/secret.txt', from, dir).error, /outside/);
    assert.match(resolveLocal('link.txt', from, dir).error, /outside/);
    assert.match(resolveLocal('/etc/passwd', from, dir).error, /not found/);
    assert.match(resolveLocal('file:///etc/passwd', from, dir).error, /not a local path/);
    assert.match(resolveLocal('%2e%2e/%2e%2e/etc/passwd', from, dir).error, /outside|not found/);
    assert.match(resolveLocal('x', from, null).error, /not on disk/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('raw html is sanitized: no script, handlers, javascript: links, frames, forms or styles', () => {
  const r = R(fs.readFileSync(path.join(SAMPLES, 'hostile-raw-html.rst'), 'utf8'));
  const h = r.chunks.join('');
  assert.match(h, /<p id="raw-ok">Allowed paragraph with <b>bold<\/b>.<\/p>/);
  assert.doesNotMatch(h, /<script|\son[a-z]+=|<iframe|<form|<object|<svg|<math|<style|\sstyle=|(href|src)="\s*(javascript|data:text|vbscript)/i);
  assert.equal((h.match(/<a /g) || []).filter(a => /href=/.test(a)).length, 0);
  assert.match(h, /class="refused-link"/);
  assert.ok(r.warnings.some(w => /unsafe tag/.test(w.message)));
});

test('sanitizer and safeHref unit cases', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref(' JaVaScRiPt:alert(1)'), null);
  assert.equal(safeHref('java\tscript:alert(1)'), null);
  assert.equal(safeHref('java&#x09;script:alert(1)'), null);
  assert.equal(safeHref('vbscript:x'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('https://ok.example'), 'https://ok.example');
  assert.equal(safeHref('docs/page.rst#x'), 'docs/page.rst#x');
  assert.equal(safeHref('//cdn.example/x'), 'https://cdn.example/x');
  const s = sanitizeHtml('<a href="javascript:x" onclick="y">a</a><img src=x onerror=alert(1)><scr<script>ipt>alert(1)</script><style>*{}</style><b>ok</b>');
  assert.doesNotMatch(s.html, /javascript|onclick|onerror|<script|<style/i);
  assert.match(s.html, /<b>ok<\/b>/);
  assert.ok(s.removed >= 4);
});

test('hostile inputs: 500-deep quotes, long garbage lines and a 3000-char table border finish fast', () => {
  for (const f of ['hostile-deep.rst', 'hostile-garbage.rst']) {
    const t0 = Date.now();
    const r = R(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
    assert.ok(Date.now() - t0 < 3000, f + ' took ' + (Date.now() - t0));
    assert.ok(r.chunks.length > 0);
    assert.ok(r.warnings.length <= 1000);
  }
  const deep = R(fs.readFileSync(path.join(SAMPLES, 'hostile-deep.rst'), 'utf8'));
  assert.ok(deep.warnings.some(w => /Nesting deeper than/.test(w.message)));
});

test('a 2 MB document with 5,000 sections renders in well under 3 s', () => {
  const parts = ['Large', '=====', ''];
  for (let k = 1; k <= 5000; k++) parts.push(`Section ${k}`, '-'.repeat(String(k).length + 8), '', `Paragraph ${k} with *em*, **strong**, \`\`code\`\` and a \`link <https://e.org/${k}>\`_. ` + 'filler text '.repeat(25), '', `- item ${k}`, '', '.. note:: n', '');
  const text = parts.join('\n');
  assert.ok(text.length > 2e6, String(text.length));
  renderRst(text, {}); // warm up
  const t0 = Date.now();
  const r = renderRst(text, { highlight });
  const ms = Date.now() - t0;
  assert.equal(r.sections.length, 5001);
  assert.ok(ms < 3000, 'took ' + ms);
});

test('every real sample renders without an exception and has headings', () => {
  for (const f of fs.readdirSync(SAMPLES).filter(f => f.endsWith('.rst'))) {
    const r = R(fs.readFileSync(path.join(SAMPLES, f), 'utf8'), { fileName: f });
    assert.ok(r.chunks.length > 0, f);
    if (!/hostile-cycle/.test(f)) assert.ok(r.sections.length > 0, f);
  }
});

test('data-line attributes point at the source lines (scroll sync)', () => {
  const r = R('Title\n=====\n\nPara one\ncontinues.\n\n- item\n\n.. note:: x\n');
  const lines = [...r.chunks.join('').matchAll(/data-line="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(lines, [0, 3, 6, 6, 8, 8]);
});

test('outlineSections: titles and lines without rendering', () => {
  assert.deepEqual(outlineSections('Top\n===\n\nA *b*\n-----\n\ntext\n'), [{ title: 'Top', level: 1, line: 0 }, { title: 'A b', level: 2, line: 3 }]);
});
