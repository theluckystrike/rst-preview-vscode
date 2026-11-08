// RST Preview webview. Receives HTML chunks from the extension host, replaces only the chunks that changed, renders
// math with KaTeX, keeps the scroll position, syncs scrolling with the editor and handles links. No network.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const content = $('content'), scroller = $('scroller'), outline = $('outline'), status = $('status'), problem = $('problem');
  const st = vscode.getState() || {};
  let chunks = [];           // html of each top-level block, as shown
  let nodes = [];            // the DOM nodes of each chunk
  let index = [];            // [{line, el}] sorted by line, for scroll sync
  let sections = [];
  let version = 0, ready = false, lastMs = 0, renderCount = 0, syncLock = 0, scrollSync = true, lastPostLine = -1;
  let mathOk = 0, mathErr = 0, warnings = 0, stats = {};
  let uri = st.uri || '';

  function setStyle(s) {
    document.body.classList.toggle('style-github', s === 'github');
    document.body.classList.toggle('style-vscode', s !== 'github');
    $('styleGithub').setAttribute('aria-pressed', String(s === 'github'));
    $('styleVscode').setAttribute('aria-pressed', String(s !== 'github'));
  }

  // ---- render
  function parse(html) { const t = document.createElement('template'); t.innerHTML = html; return Array.from(t.content.childNodes); }
  function apply(next) {
    let a = 0;
    while (a < chunks.length && a < next.length && chunks[a] === next[a]) a++;
    let b = 0;
    while (b < chunks.length - a && b < next.length - a && chunks[chunks.length - 1 - b] === next[next.length - 1 - b]) b++;
    const oldMid = nodes.slice(a, chunks.length - b);
    const anchor = (b > 0 && nodes[chunks.length - b] && nodes[chunks.length - b][0]) || null;
    for (const group of oldMid) for (const n of group) n.remove();
    const added = [];
    const newGroups = next.slice(a, next.length - b).map(h => { const g = parse(h); added.push(...g); return g; });
    const frag = document.createDocumentFragment();
    for (const g of newGroups) for (const n of g) frag.appendChild(n);
    if (anchor && anchor.parentNode === content) content.insertBefore(frag, anchor); else content.appendChild(frag);
    nodes = nodes.slice(0, a).concat(newGroups, nodes.slice(chunks.length - b));
    chunks = next.slice();
    for (const n of added) if (n.nodeType === 1) decorate(n);
    return added.length;
  }

  // Styles come as data- attributes (the CSP allows no style attributes), set here through the CSSOM.
  function decorate(root) {
    const all = root.querySelectorAll ? [root, ...root.querySelectorAll('[data-style],[data-indent],[data-w],[data-scale],.math,img')] : [];
    for (const el of all) {
      if (el.dataset && el.dataset.style) for (const decl of el.dataset.style.split(';')) { const m = /^\s*(width|height)\s*:\s*([\d.]+(px|em|ex|%|pt|pc|cm|mm|in|vw|vh|rem))\s*$/.exec(decl); if (m) el.style[m[1]] = m[2]; }
      if (el.dataset && el.dataset.indent) el.style.marginLeft = Math.min(40, Number(el.dataset.indent) || 0) + 'ch';
      if (el.dataset && el.dataset.w) el.style.width = Number(el.dataset.w) + '%';
      if (el.tagName === 'IMG') {
        if (el.dataset.scale) el.addEventListener('load', () => { const k = Number(el.dataset.scale) / 100; if (k > 0) { el.style.width = el.naturalWidth * k + 'px'; } }, { once: true });
        el.addEventListener('error', () => { el.classList.add('broken'); el.title = 'Picture could not be loaded: ' + (el.getAttribute('alt') || ''); }, { once: true });
      }
      if (el.classList && el.classList.contains('math') && !el.dataset.done) renderMath(el);
    }
  }
  function renderMath(el) {
    el.dataset.done = '1';
    const tex = el.dataset.tex || '';
    if (typeof katex === 'undefined') return;
    try { katex.render(tex, el, { displayMode: el.classList.contains('display'), throwOnError: true, strict: 'ignore', trust: false, maxSize: 200, maxExpand: 2000, output: 'htmlAndMathml' }); mathOk++; }
    catch (e) { mathErr++; el.classList.add('math-error'); el.textContent = tex; el.title = 'Math error: ' + String(e && e.message || e).slice(0, 200); }
  }

  function buildIndex() {
    index = [];
    for (const el of content.querySelectorAll('[data-line]')) { const n = Number(el.dataset.line); if (Number.isFinite(n)) index.push({ line: n, el }); }
    index.sort((x, y) => x.line - y.line);
  }

  function buildOutline() {
    outline.textContent = '';
    if (!sections.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No section titles in this file.'; outline.appendChild(p); return; }
    const min = Math.min(...sections.map(s => s.level));
    const max = 2000;
    for (const s of sections.slice(0, max)) {
      const a = document.createElement('a');
      a.href = '#' + s.id; a.textContent = s.title.replace(/[`*]|\\(?=.)/g, ''); a.className = 'lvl' + Math.min(6, s.level - min + 1); a.dataset.id = s.id;
      outline.appendChild(a);
    }
    if (sections.length > max) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = `… ${sections.length - max} more sections`; outline.appendChild(p); }
  }

  function render(m) {
    const t0 = performance.now();
    const keepLine = topLine();
    const firstRender = renderCount === 0;
    if (content.querySelector('.loading,.notice-page')) { content.textContent = ''; chunks = []; nodes = []; }
    apply(Array.isArray(m.chunks) ? m.chunks : []);
    if (!chunks.length) content.innerHTML = '<p class="empty-doc">This file is empty. Type some reStructuredText.</p>';
    sections = Array.isArray(m.sections) ? m.sections : [];
    buildIndex(); buildOutline();
    version = m.version; warnings = m.warnings || 0; stats = m.stats || {};
    problem.classList.add('hidden');
    renderCount++;
    if (firstRender && Number.isInteger(m.line) && m.line > 0) scrollToLine(m.line);
    else if (!firstRender && keepLine >= 0) scrollToLine(keepLine, true);
    lastMs = Math.round(performance.now() - t0);
    const parts = [];
    if (sections.length) parts.push(`${sections.length} section${sections.length === 1 ? '' : 's'}`);
    if (warnings) parts.push(`<a href="#" id="probLink" title="Open the Problems panel">${warnings} warning${warnings === 1 ? '' : 's'}</a>`);
    parts.push(`${(stats.ms || 0) + lastMs} ms`);
    status.innerHTML = parts.join(' · ');
    const pl = $('probLink'); if (pl) pl.addEventListener('click', e => { e.preventDefault(); vscode.postMessage({ type: 'showProblems' }); });
    highlightOutline();
    vscode.postMessage({ type: 'rendered', version });
  }

  // ---- scroll sync
  function elTop(el) { const r = el.getBoundingClientRect(); return r.top - scroller.getBoundingClientRect().top + scroller.scrollTop; }
  function scrollToLine(line, quiet) {
    if (!index.length) return;
    let lo = 0, hi = index.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (index[mid].line <= line) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    let y;
    if (k < 0) y = 0;
    else {
      const cur = index[k], nxt = index[k + 1];
      const y0 = elTop(cur.el);
      if (nxt && nxt.line > cur.line) { const y1 = elTop(nxt.el); y = y0 + (y1 - y0) * Math.min(1, (line - cur.line) / (nxt.line - cur.line)); }
      else { const r = cur.el.getBoundingClientRect(); y = y0 + Math.min(r.height, 0); }
    }
    syncLock = Date.now();
    scroller.scrollTop = Math.max(0, y - 4);
  }
  function topLine() {
    if (!index.length) return -1;
    const top = scroller.scrollTop;
    if (top < 2) return 0;
    let lo = 0, hi = index.length - 1, k = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (elTop(index[mid].el) <= top + 4) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    const cur = index[k], nxt = index[k + 1];
    if (!nxt) return cur.line;
    const y0 = elTop(cur.el), y1 = elTop(nxt.el);
    if (y1 <= y0) return cur.line;
    return Math.floor(cur.line + (nxt.line - cur.line) * Math.max(0, Math.min(1, (top - y0) / (y1 - y0))));
  }
  let scrollTimer = null;
  scroller.addEventListener('scroll', () => {
    highlightOutlineSoon();
    if (!scrollSync || Date.now() - syncLock < 250) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { const l = topLine(); if (l >= 0 && l !== lastPostLine) { lastPostLine = l; vscode.postMessage({ type: 'revealLine', line: l }); } }, 40);
  }, { passive: true });

  let olTimer = null;
  function highlightOutlineSoon() { clearTimeout(olTimer); olTimer = setTimeout(highlightOutline, 80); }
  function highlightOutline() {
    if (outline.classList.contains('hidden') || !sections.length) return;
    const top = scroller.scrollTop + 8;
    let cur = null;
    for (const s of sections) { const el = document.getElementById(s.id); if (!el) continue; if (elTop(el) <= top) cur = s.id; else break; }
    for (const a of outline.querySelectorAll('a.current')) a.classList.remove('current');
    const a = cur && outline.querySelector(`a[data-id="${CSS.escape(cur)}"]`);
    if (a) { a.classList.add('current'); const r = a.getBoundingClientRect(), o = outline.getBoundingClientRect(); if (r.top < o.top || r.bottom > o.bottom) a.scrollIntoView({ block: 'nearest' }); }
  }

  // ---- links and clicks
  function jump(id) { const el = document.getElementById(id) || document.getElementsByName(id)[0]; if (el) { syncLock = 0; scroller.scrollTop = elTop(el) - 6; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); } }
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.closest('.zovo-support')) return; // command: links of the support footer are handled by VS Code
    const href = a.getAttribute('href');
    e.preventDefault();
    if (!href) return;
    if (href.startsWith('#')) { if (href.length > 1) jump(decodeURIComponent(href.slice(1))); return; }
    vscode.postMessage({ type: 'link', href });
  });
  content.addEventListener('dblclick', e => {
    if (e.target.closest && e.target.closest('a')) return;
    const el = e.target.closest && e.target.closest('[data-line]');
    if (el) vscode.postMessage({ type: 'openSource', line: Number(el.dataset.line) });
  });
  outline.addEventListener('click', e => { const a = e.target.closest('a[data-id]'); if (a) { e.preventDefault(); e.stopPropagation(); jump(a.dataset.id); } });

  // ---- toolbar
  $('outlineBtn').addEventListener('click', () => toggleOutline());
  function toggleOutline(force) {
    const show = force === undefined ? outline.classList.contains('hidden') : force;
    outline.classList.toggle('hidden', !show);
    $('outlineBtn').setAttribute('aria-pressed', String(show));
    vscode.setState({ ...(vscode.getState() || {}), uri, outline: show });
    highlightOutline();
  }
  $('styleGithub').addEventListener('click', () => { setStyle('github'); vscode.postMessage({ type: 'style', style: 'github' }); });
  $('styleVscode').addEventListener('click', () => { setStyle('vscode'); vscode.postMessage({ type: 'style', style: 'vscode' }); });
  $('exportBtn').addEventListener('click', () => exportNow());
  $('sourceBtn').addEventListener('click', () => vscode.postMessage({ type: 'showSource' }));
  function exportNow() {
    const title = (sections[0] && sections[0].title) || document.title;
    vscode.postMessage({ type: 'export', html: content.innerHTML, title });
  }

  // ---- messages
  window.addEventListener('message', ev => {
    const m = ev.data;
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'init': uri = m.uri || uri; scrollSync = m.scrollSync !== false; setStyle(m.style); vscode.setState({ ...(vscode.getState() || {}), uri }); if (st.outline) toggleOutline(true); break;
      case 'render': try { render(m); } catch (e) { showProblem('The page could not show this render: ' + (e && e.message || e)); } break;
      case 'error': showProblem(m.message); break;
      case 'scrollTo': if (Number.isInteger(m.line)) scrollToLine(m.line); break;
      case 'style': setStyle(m.style); break;
      case 'exportNow': exportNow(); break;
      case 'tooLarge': {
        content.innerHTML = '';
        const d = document.createElement('div'); d.className = 'notice-page';
        const mb = (m.size / 1048576).toFixed(1);
        d.innerHTML = `<h3>Large file</h3><p></p><p><button id="anyway" class="primary">Render anyway</button></p>`;
        d.querySelector('p').textContent = `${m.fileName} has ${mb} million characters. RST Preview renders files up to ${m.limitMB} MB right away (setting rstPreview.maxFileMB). Rendering a very large file can take a few seconds each time you type.`;
        content.appendChild(d); chunks = []; nodes = [];
        $('anyway').addEventListener('click', () => { d.querySelector('p').textContent = 'Rendering…'; vscode.postMessage({ type: 'renderAnyway' }); });
        status.textContent = 'Not rendered: large file';
        break;
      }
    }
  });
  function showProblem(msg) {
    problem.textContent = '';
    const b = document.createElement('strong'); b.textContent = 'Not updated: ';
    problem.append(b, String(msg || 'unknown error'), ' The last good render is shown below.');
    problem.classList.remove('hidden');
  }

  // Test hook for the release gate (read-only numbers about the page).
  window.rstProbe = full => full ? fullProbe() : ({ ready, version, renders: renderCount, chunks: chunks.length, sections: sections.length, topLine: topLine(), scrollTop: Math.round(scroller.scrollTop),
    problem: problem.classList.contains('hidden') ? '' : problem.textContent, notice: !!content.querySelector('.notice-page'), style: document.body.classList.contains('style-github') ? 'github' : 'vscode',
    outline: !outline.classList.contains('hidden'), outlineItems: outline.querySelectorAll('a').length, bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(content).color, lastMs, stats, mathOk, mathErr, warnings,
    images: content.querySelectorAll('img').length, imagesLoaded: Array.from(content.querySelectorAll('img')).filter(i => i.complete && i.naturalWidth > 0).length });
  const fullProbe = () => ({
    ready, version, renders: renderCount, chunks: chunks.length, sections: sections.length, headings: content.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    paragraphs: content.querySelectorAll('p').length, tables: content.querySelectorAll('table').length, admonitions: content.querySelectorAll('.admonition').length,
    code: content.querySelectorAll('pre').length, hl: content.querySelectorAll('pre .hljs-keyword,pre .hljs-string').length, lists: content.querySelectorAll('ul,ol').length,
    listItems: content.querySelectorAll('li').length, images: content.querySelectorAll('img').length, imagesLoaded: Array.from(content.querySelectorAll('img')).filter(i => i.complete && i.naturalWidth > 0).length,
    missingImages: content.querySelectorAll('.image-missing').length, math: content.querySelectorAll('.katex').length, mathOk, mathErr, footnotes: content.querySelectorAll('aside.footnote').length,
    sphinxBoxes: content.querySelectorAll('.sphinx-box').length, problematic: content.querySelectorAll('.problematic').length, warnings, problem: problem.classList.contains('hidden') ? '' : problem.textContent,
    scripts: content.querySelectorAll('script').length, handlers: Array.from(content.querySelectorAll('*')).filter(e => Array.from(e.attributes).some(x => /^on/i.test(x.name))).length,
    jsLinks: Array.from(content.querySelectorAll('a[href]')).filter(a => /^\s*javascript:/i.test(a.getAttribute('href'))).length, iframes: content.querySelectorAll('iframe,object,embed').length,
    pwned: !!window.__pwned, textLength: content.textContent.length, scrollTop: Math.round(scroller.scrollTop), scrollHeight: scroller.scrollHeight, topLine: topLine(),
    style: document.body.classList.contains('style-github') ? 'github' : 'vscode', outline: !outline.classList.contains('hidden'), outlineItems: outline.querySelectorAll('a').length,
    dark: document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'), bg: getComputedStyle(scroller).backgroundColor, fg: getComputedStyle(content).color,
    notice: !!content.querySelector('.notice-page'), lastMs, stats,
  });
  ready = true;
  vscode.postMessage({ type: 'ready' });
})();
