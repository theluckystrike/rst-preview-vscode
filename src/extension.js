'use strict';
// RST Preview: a live reStructuredText preview with no Python, no Sphinx and no network. The extension host renders
// the text VS Code already has open (src/core/rst.js) and sends HTML chunks to the webview, which shows them with
// math (KaTeX), outline and scroll sync. Includes and images are read only from inside the workspace folder.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { renderRst, outlineSections } = require('./core/rst');
const { resolveLocal, realOrNull } = require('./core/paths');
const { highlight } = require('./highlight');
const { buildHtml, noticeHtml } = require('./html');
const { exportDocument } = require('./export');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');

const SECTION = 'rstPreview';
const VIEW_TYPE = 'rstPreview.preview';
const EXT_ID = 'zovo.rst-preview';
const STYLE_KEY = 'rstPreview.style';
let rating = { success() {}, failure() {} };

function settings() {
  const c = vscode.workspace.getConfiguration(SECTION);
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return {
    style: c.get('style', 'vscode') === 'github' ? 'github' : 'vscode',
    delay: num(c.get('updateDelayMs', 250), 0, 5000, 250),
    maxFileMB: num(c.get('maxFileMB', 20), 1, 1024, 20),
    scrollSync: c.get('scrollSync', true) !== false,
    problems: ['warnings', 'all', 'off'].includes(c.get('problems', 'warnings')) ? c.get('problems', 'warnings') : 'warnings',
    fontSize: num(c.get('fontSize', 0), 0, 40, 0),
  };
}

const RST_EXT = /\.(rst|rest|rst\.txt)$/i;
function isRst(doc) { return !!doc && (doc.languageId === 'restructuredtext' || doc.languageId === 'rst' || RST_EXT.test(doc.uri.path)); }

/** Folder that includes, images and links may read from: the workspace folder of the file, else the file's own folder. */
function rootOf(uri) {
  const wf = vscode.workspace.getWorkspaceFolder(uri);
  if (wf && wf.uri.scheme === 'file') return wf.uri.fsPath;
  return uri.scheme === 'file' ? path.dirname(uri.fsPath) : null;
}
class Preview {
  constructor(manager, uri, panel) {
    this.manager = manager; this.uri = uri; this.key = uri.toString(); this.panel = panel;
    this.fileName = path.basename(uri.path);
    this.timer = null; this.ready = false; this.disposed = false; this.pending = false; this.counted = false;
    this.version = 0; this.forceLarge = false; this.lastGood = null; this.syncLock = 0; this.lastLine = -1;
    this.root = rootOf(uri);
    this.subs = [
      panel.webview.onDidReceiveMessage(m => this.onMessage(m).catch(err => vscode.window.showErrorMessage('RST Preview: ' + (err && err.message || err)))),
      panel.onDidDispose(() => this.dispose()),
      panel.onDidChangeViewState(e => { if (e.webviewPanel.visible && this.pending) { this.pending = false; this.schedule(0); } }),
    ];
    panel.iconPath = vscode.Uri.joinPath(manager.context.extensionUri, 'media', 'preview-icon.svg');
    this.load();
  }

  load() {
    const wv = this.panel.webview;
    const media = vscode.Uri.joinPath(this.manager.context.extensionUri, 'media');
    const roots = [media];
    if (this.root) roots.push(vscode.Uri.file(this.root));
    wv.options = { enableScripts: true, localResourceRoots: roots, enableCommandUris: commandUris(SECTION) };
    this.ready = false;
    const asUri = f => wv.asWebviewUri(vscode.Uri.joinPath(media, ...f.split('/'))).toString();
    const s = settings();
    wv.html = buildHtml({
      cspSource: wv.cspSource, scriptUri: asUri('preview.js'), styleUri: asUri('preview.css'), katexUri: asUri('katex/katex.min.js'), katexCss: asUri('katex/katex.min.css'),
      title: this.fileName, style: this.style(), fontSize: s.fontSize, showSupportLinks: showLinks(vscode, SECTION),
    });
  }

  style() { const v = this.manager.context.globalState.get(STYLE_KEY); return v === 'github' || v === 'vscode' ? v : settings().style; }

  doc() { return vscode.workspace.textDocuments.find(d => d.uri.toString() === this.key); }

  post(m) { if (!this.disposed) this.panel.webview.postMessage(m).then(undefined, () => {}); }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { try { this.update(); } catch (err) { this.fail(err); } }, delay);
  }

  update() {
    if (this.disposed || !this.ready) return;
    if (!this.panel.visible) { this.pending = true; return; }
    const doc = this.doc();
    if (!doc) return;
    const s = settings();
    const text = doc.getText();
    if (!this.forceLarge && text.length > s.maxFileMB * 1048576) {
      this.post({ type: 'tooLarge', size: text.length, limitMB: s.maxFileMB, fileName: this.fileName });
      return;
    }
    const wv = this.panel.webview;
    const root = this.root;
    const main = doc.uri.scheme === 'file' ? doc.uri.fsPath : null;
    const t0 = Date.now();
    const r = renderRst(text, {
      fileName: this.fileName, fileKey: main ? (realOrNull(main) || main) : this.key, fileUri: main,
      highlight,
      readFile: (target, from) => {
        const res = resolveLocal(target, from && from.uri ? from.uri : main, root);
        if (res.error) return { error: res.error };
        const st = fs.statSync(res.file);
        if (!st.isFile()) return { error: `not a file: ${target}` };
        if (st.size > 8 * 1048576) return { error: `larger than 8 MB: ${target}` };
        return { text: fs.readFileSync(res.file, 'utf8'), key: res.file, name: path.basename(res.file), uri: res.file };
      },
      resolveImage: (target, from) => {
        const res = resolveLocal(target, from && from.uri ? from.uri : main, root);
        if (res.error) return null;
        return { src: wv.asWebviewUri(vscode.Uri.file(res.file)).toString(), path: res.file };
      },
      imageError: (target, from) => resolveLocal(target, from && from.uri ? from.uri : main, root).error || 'not shown',
    });
    this.version++;
    this.lastGood = r;
    this.manager.setProblems(doc, r.warnings, s.problems);
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.key);
    const line = ed && ed.visibleRanges.length ? ed.visibleRanges[0].start.line : -1;
    this.post({ type: 'render', version: this.version, chunks: r.chunks, sections: r.sections, stats: { ...r.stats, ms: Date.now() - t0, chars: text.length },
      warnings: r.warnings.filter(w => w.level >= 2).length, title: r.title, line: s.scrollSync ? line : -1, fileName: this.fileName });
    this.manager.outlineChanged(this.key);
  }

  fail(err) {
    // Keep the last good render on the page and show what went wrong above it.
    const doc = this.doc();
    this.post({ type: 'error', message: String(err && err.message || err).slice(0, 400) });
    if (!this.counted) { this.counted = true; rating.failure(); }
    if (doc) this.manager.setProblems(doc, [{ line: 0, file: 0, level: 3, message: 'RST Preview could not render this file: ' + String(err && err.message || err).slice(0, 300) }], 'warnings');
  }

  async onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'ready': this.ready = true; this.post({ type: 'init', style: this.style(), scrollSync: settings().scrollSync, uri: this.key }); this.schedule(0); break;
      case 'rendered':
        if (!this.counted && m.version === this.version) { this.counted = true; rating.success(); }
        break;
      case 'renderAnyway': this.forceLarge = true; this.schedule(0); break;
      case 'style': if (m.style === 'github' || m.style === 'vscode') await this.manager.context.globalState.update(STYLE_KEY, m.style); break;
      case 'revealLine': if (Number.isInteger(m.line) && m.line >= 0 && settings().scrollSync) this.revealInEditor(m.line, false); break;
      case 'openSource': if (Number.isInteger(m.line) && m.line >= 0) await this.showSource(m.line); break;
      case 'link': if (typeof m.href === 'string') await this.openLink(m.href); break;
      case 'export': if (typeof m.html === 'string') await this.saveExport(m.html, String(m.title || '')); break;
      case 'exportRequest': await vscode.commands.executeCommand('rstPreview.exportHtml'); break;
      case 'showSource': await this.showSource(-1); break;
      case 'showProblems': await vscode.commands.executeCommand('workbench.actions.view.problems'); break;
    }
  }

  revealInEditor(line, focus) {
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.key);
    if (!ed) return;
    const l = Math.min(line, ed.document.lineCount - 1);
    this.syncLock = Date.now();
    ed.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.AtTop);
  }

  async showSource(line) {
    const doc = this.doc() || await vscode.workspace.openTextDocument(this.uri);
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.key);
    const opts = { viewColumn: ed ? ed.viewColumn : (this.panel.viewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One), preserveFocus: false };
    if (line >= 0) { const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), 0); opts.selection = new vscode.Range(pos, pos); }
    const shown = await vscode.window.showTextDocument(doc, opts);
    if (line >= 0) shown.revealRange(opts.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async openLink(href) {
    const h = href.trim();
    if (/^(https?|mailto|ftp):/i.test(h)) { await vscode.env.openExternal(vscode.Uri.parse(h)); return; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^[a-z]:[\\/]/i.test(h)) { vscode.window.showWarningMessage(`RST Preview does not open "${h.slice(0, 60)}" links.`); return; }
    const main = this.uri.scheme === 'file' ? this.uri.fsPath : null;
    let res = resolveLocal(h, main, this.root);
    if (res.error && /\.rst$/.test(h.split('#')[0])) { // :doc: and toctree links: try .txt and folder/index.rst too
      for (const alt of [h.split('#')[0].replace(/\.rst$/, '.txt'), h.split('#')[0].replace(/\.rst$/, '/index.rst'), h.split('#')[0].replace(/\.rst$/, '')]) {
        const r2 = resolveLocal(alt, main, this.root); if (!r2.error) { res = r2; break; }
      }
    }
    if (res.error) { vscode.window.showWarningMessage(`RST Preview: link not opened, ${res.error}`); return; }
    const uri = vscode.Uri.file(res.file);
    if (RST_EXT.test(res.file)) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: true });
      await this.manager.open(uri, this.panel.viewColumn || vscode.ViewColumn.Beside);
      return;
    }
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  async saveExport(bodyHtml, title) {
    const base = this.fileName.replace(/\.(rst|rest|txt)$/i, '') + '.html';
    const dir = this.uri.scheme === 'file' ? vscode.Uri.file(path.dirname(this.uri.fsPath)) : undefined;
    const target = await vscode.window.showSaveDialog({ defaultUri: dir ? vscode.Uri.joinPath(dir, base) : undefined, filters: { HTML: ['html', 'htm'] }, saveLabel: 'Export HTML' });
    if (!target) return;
    if (target.toString() === this.key) { vscode.window.showErrorMessage('Choose a different file; this would overwrite the RST source.'); return; }
    const html = exportDocument({ body: bodyHtml, title: title || this.fileName, mediaDir: path.join(this.manager.context.extensionPath, 'media'), root: this.root, style: this.style() });
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
    const pick = await vscode.window.showInformationMessage(`RST Preview: saved ${path.basename(target.path)} (${(html.length / 1024).toFixed(0)} KB, one file, works offline).`, 'Open in Browser');
    if (pick) await vscode.env.openExternal(target);
  }

  onEditorScroll(editor) {
    if (!settings().scrollSync || Date.now() - this.syncLock < 400) return;
    const r = editor.visibleRanges[0];
    if (!r) return;
    const line = r.start.line;
    if (line === this.lastLine) return;
    this.lastLine = line;
    this.post({ type: 'scrollTo', line });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer);
    this.subs.forEach(s => s.dispose());
    this.manager.previews.delete(this.key);
    this.manager.diagnostics.delete(this.uri);
  }
}

class Manager {
  constructor(context) {
    this.context = context; this.previews = new Map();
    this.diagnostics = vscode.languages.createDiagnosticCollection('rst-preview');
    this.symbolEvents = new vscode.EventEmitter();
  }
  setProblems(doc, warnings, mode) {
    if (mode === 'off') { this.diagnostics.delete(doc.uri); return; }
    const list = warnings.filter(w => w.file === 0 && (mode === 'all' || w.level >= 2)).slice(0, 500);
    this.diagnostics.set(doc.uri, list.map(w => {
      const line = Math.max(0, Math.min(w.line, doc.lineCount - 1));
      const text = doc.lineAt(line).text;
      const d = new vscode.Diagnostic(new vscode.Range(line, text.length - text.trimStart().length, line, Math.max(text.length, 1)), w.message,
        w.level >= 3 ? vscode.DiagnosticSeverity.Error : w.level === 2 ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = 'RST Preview';
      return d;
    }));
  }
  outlineChanged() {}
  panel(uri, column) {
    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media')];
    const root = rootOf(uri);
    if (root) roots.push(vscode.Uri.file(root));
    return vscode.window.createWebviewPanel(VIEW_TYPE, 'Preview ' + path.basename(uri.path), { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: false, enableFindWidget: true, enableCommandUris: commandUris(SECTION), localResourceRoots: roots });
  }
  async open(uri, column) {
    const existing = this.previews.get(uri.toString());
    if (existing) { existing.panel.reveal(column, true); return existing; }
    const s = settings();
    const isOpen = vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString());
    if (!isOpen) {
      // A large file is not read just to say it is too large.
      let size = -1;
      try { size = (await vscode.workspace.fs.stat(uri)).size; } catch {}
      if (size > s.maxFileMB * 1048576) {
        const pick = await vscode.window.showWarningMessage(`${path.basename(uri.path)} is ${(size / 1048576).toFixed(1)} MB. RST Preview renders files up to ${s.maxFileMB} MB (setting rstPreview.maxFileMB).`, 'Open Settings');
        if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'rstPreview.maxFileMB');
        return null;
      }
      await vscode.workspace.openTextDocument(uri);
    }
    const p = new Preview(this, uri, this.panel(uri, column));
    this.previews.set(p.key, p);
    return p;
  }
  async revive(panel, uri) {
    try { await vscode.workspace.openTextDocument(uri); } catch { panel.dispose(); return; }
    if (this.previews.has(uri.toString())) { panel.dispose(); return; }
    const p = new Preview(this, uri, panel);
    this.previews.set(p.key, p);
  }
  active() {
    for (const p of this.previews.values()) if (p.panel.active) return p;
    const ed = vscode.window.activeTextEditor;
    if (ed && this.previews.has(ed.document.uri.toString())) return this.previews.get(ed.document.uri.toString());
    return [...this.previews.values()].find(p => p.panel.visible) || null;
  }
  dispose() { for (const p of [...this.previews.values()]) p.panel.dispose(); this.diagnostics.dispose(); }
}

/** Sections of an RST document for the Outline view and breadcrumbs. */
function symbols(doc) {
  if (doc.getText().length > 50 * 1048576) return [];
  const secs = outlineSections(doc.getText());
  const out = [], stack = [];
  secs.forEach((s, k) => {
    // a section runs to the line before the next section at the same or a higher level
    let end = doc.lineCount - 1;
    for (let j = k + 1; j < secs.length; j++) if (secs[j].level <= s.level) { end = Math.max(s.line, secs[j].line - 1); break; }
    const line = Math.min(s.line, doc.lineCount - 1);
    const sym = new vscode.DocumentSymbol(s.title.replace(/\s+/g, ' ').slice(0, 200) || '(untitled)', '', vscode.SymbolKind.String,
      new vscode.Range(line, 0, Math.max(line, Math.min(end, doc.lineCount - 1)), 0), new vscode.Range(line, 0, line, doc.lineAt(line).text.length));
    while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
    if (stack.length) stack[stack.length - 1].sym.children.push(sym); else out.push(sym);
    stack.push({ level: s.level, sym });
  });
  return out;
}

function targetUri(arg) {
  if (arg instanceof vscode.Uri) return arg;
  const ed = vscode.window.activeTextEditor;
  if (ed) return ed.document.uri;
  return null;
}

function activate(context) {
  const manager = new Manager(context);
  context.subscriptions.push({ dispose: () => manager.dispose() });
  registerSupport({ vscode, context, prefix: SECTION, selfId: EXT_ID });
  rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: SECTION, name: 'RST Preview' });

  const openCmd = side => async arg => {
    const uri = targetUri(arg);
    if (!uri) { vscode.window.showInformationMessage('Open a .rst file first, then run RST Preview.'); return; }
    const ed = vscode.window.activeTextEditor;
    const col = side ? vscode.ViewColumn.Beside : (ed ? ed.viewColumn : vscode.ViewColumn.Active);
    return manager.open(uri, col);
  };
  let scrollTimer = null;
  context.subscriptions.push(
    vscode.commands.registerCommand('rstPreview.showPreviewToSide', openCmd(true)),
    vscode.commands.registerCommand('rstPreview.showPreview', openCmd(false)),
    vscode.commands.registerCommand('rstPreview.showSource', async () => { const p = manager.active(); if (p) await p.showSource(-1); }),
    vscode.commands.registerCommand('rstPreview.exportHtml', async arg => {
      let p = manager.active();
      if (!p) { const uri = targetUri(arg); if (uri) p = await manager.open(uri, vscode.ViewColumn.Beside); }
      if (!p) { vscode.window.showInformationMessage('Open a .rst file first.'); return; }
      p.post({ type: 'exportNow' });
    }),
    vscode.commands.registerCommand('rstPreview.toggleStyle', async () => {
      const cur = manager.context.globalState.get(STYLE_KEY) || settings().style;
      const next = cur === 'github' ? 'vscode' : 'github';
      await manager.context.globalState.update(STYLE_KEY, next);
      for (const p of manager.previews.values()) p.post({ type: 'style', style: next });
    }),
    vscode.commands.registerCommand('rstPreview.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#rstPreview.start`, false)),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel, state) {
        const u = state && typeof state.uri === 'string' ? state.uri : '';
        if (!u) { panel.dispose(); return; }
        await manager.revive(panel, vscode.Uri.parse(u));
      },
    }),
    vscode.languages.registerDocumentSymbolProvider([{ language: 'restructuredtext' }, { pattern: '**/*.rst' }, { pattern: '**/*.rest' }], { provideDocumentSymbols: doc => symbols(doc) }, { label: 'RST Preview' }),
    vscode.workspace.onDidChangeTextDocument(e => {
      const p = manager.previews.get(e.document.uri.toString());
      if (p && e.contentChanges.length) {
        const n = e.document.getText().length;
        // Big documents wait a little longer between renders while you type.
        p.schedule(settings().delay + (n > 500000 ? 700 : n > 100000 ? 200 : 0));
      }
      // An edit in an included file renders the files that include it.
      if (e.contentChanges.length && e.document.uri.scheme === 'file') {
        const f = e.document.uri.fsPath;
        for (const q of manager.previews.values()) if (q !== p && q.lastGood && q.lastGood.files.some(x => x.key === f)) q.schedule(settings().delay + 300);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      const f = doc.uri.scheme === 'file' ? doc.uri.fsPath : '';
      for (const q of manager.previews.values()) if (q.lastGood && q.lastGood.files.some(x => x.key === f)) q.schedule(0);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges(e => {
      const p = manager.previews.get(e.textEditor.document.uri.toString());
      if (!p) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => p.onEditorScroll(e.textEditor), 30);
    }),
    vscode.workspace.onDidCloseTextDocument(doc => { if (!manager.previews.has(doc.uri.toString())) manager.diagnostics.delete(doc.uri); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(SECTION)) return;
      if (e.affectsConfiguration(SECTION + '.style')) manager.context.globalState.update(STYLE_KEY, undefined);
      for (const p of manager.previews.values()) { p.load(); }
    }),
  );
  return { _manager: manager };
}

function deactivate() {}

module.exports = { activate, deactivate, _test: { isRst } };
