'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportDocument } = require('../src/export');
const { buildHtml, csp } = require('../src/html');

const MEDIA = path.join(__dirname, '..', 'media');

test('export: one file, no script, KaTeX fonts inlined, pictures inside the root inlined, others dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstp-exp-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rstp-out-'));
  try {
    const pic = path.join(dir, 'p.png');
    fs.copyFileSync(path.join(__dirname, '..', 'icon.png'), pic);
    fs.writeFileSync(path.join(out, 'x.png'), 'not inside');
    const body = `<h1 id="t" data-line="0">T</h1><img src="https://file+.vscode-resource.vscode-cdn.net${pic}" data-path="${pic}" alt="p"><img src="https://file+.vscode-resource.vscode-cdn.net/x" data-path="${path.join(out, 'x.png')}" alt="x">`;
    const html = exportDocument({ body, title: 'T <x>', mediaDir: MEDIA, root: dir, style: 'github' });
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /data-line=/);
    assert.match(html, /data:font\/woff2;base64,/);
    assert.match(html, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}"/);
    assert.match(html, /alt="picture outside the workspace"/);
    assert.match(html, /<title>T &lt;x&gt;<\/title>/);
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src data:/);
    assert.doesNotMatch(html.replace(/data:[^"')]+/g, ''), /vscode-resource|vscode-cdn/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

test('preview page: strict CSP with nonce, no remote source', () => {
  const h = buildHtml({ cspSource: 'vscode-webview://x', scriptUri: 's.js', styleUri: 's.css', katexUri: 'k.js', katexCss: 'k.css', title: '<b>t</b>', style: 'github', nonce: 'abc' }).replace(/&#39;/g, "'");
  assert.match(h, /default-src 'none'/);
  assert.match(h, /script-src 'nonce-abc'/);
  assert.match(h, /connect-src 'none'/);
  assert.doesNotMatch(csp('vscode-webview://x', 'n'), /https?:|unsafe-eval|unsafe-inline/);
  assert.match(h, /<title>&lt;b&gt;t&lt;\/b&gt;<\/title>/);
  assert.match(h, /<body class="style-github">/);
  assert.equal((h.match(/<script /g) || []).length, 2);
  assert.equal((h.match(/<script nonce="abc"/g) || []).length, 2);
});
