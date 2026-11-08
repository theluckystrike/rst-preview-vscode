'use strict';
// Code highlighting for code-block, sourcecode, literalinclude and doctest blocks. highlight.js core with a fixed
// set of languages (BSD-3-Clause, vendor/highlight.js). Runs in the extension host; the output is escaped HTML spans.
const hljs = require('../vendor/highlight.js/lib/core');
const LANGS = ['python', 'python-repl', 'javascript', 'typescript', 'bash', 'shell', 'json', 'yaml', 'ini', 'xml', 'css', 'c', 'cpp', 'java', 'rust', 'go',
  'sql', 'pgsql', 'diff', 'dockerfile', 'makefile', 'plaintext', 'markdown', 'powershell', 'ruby', 'php', 'csharp', 'kotlin', 'swift', 'lua', 'perl', 'r',
  'scala', 'latex', 'cmake', 'nginx', 'protobuf', 'graphql', 'dos'];
const MODS = {
  python: require('../vendor/highlight.js/lib/languages/python'), 'python-repl': require('../vendor/highlight.js/lib/languages/python-repl'),
  javascript: require('../vendor/highlight.js/lib/languages/javascript'), typescript: require('../vendor/highlight.js/lib/languages/typescript'),
  bash: require('../vendor/highlight.js/lib/languages/bash'), shell: require('../vendor/highlight.js/lib/languages/shell'),
  json: require('../vendor/highlight.js/lib/languages/json'), yaml: require('../vendor/highlight.js/lib/languages/yaml'),
  ini: require('../vendor/highlight.js/lib/languages/ini'), xml: require('../vendor/highlight.js/lib/languages/xml'),
  css: require('../vendor/highlight.js/lib/languages/css'), c: require('../vendor/highlight.js/lib/languages/c'),
  cpp: require('../vendor/highlight.js/lib/languages/cpp'), java: require('../vendor/highlight.js/lib/languages/java'),
  rust: require('../vendor/highlight.js/lib/languages/rust'), go: require('../vendor/highlight.js/lib/languages/go'),
  sql: require('../vendor/highlight.js/lib/languages/sql'), pgsql: require('../vendor/highlight.js/lib/languages/pgsql'),
  diff: require('../vendor/highlight.js/lib/languages/diff'), dockerfile: require('../vendor/highlight.js/lib/languages/dockerfile'),
  makefile: require('../vendor/highlight.js/lib/languages/makefile'), plaintext: require('../vendor/highlight.js/lib/languages/plaintext'),
  markdown: require('../vendor/highlight.js/lib/languages/markdown'), powershell: require('../vendor/highlight.js/lib/languages/powershell'),
  ruby: require('../vendor/highlight.js/lib/languages/ruby'), php: require('../vendor/highlight.js/lib/languages/php'),
  csharp: require('../vendor/highlight.js/lib/languages/csharp'), kotlin: require('../vendor/highlight.js/lib/languages/kotlin'),
  swift: require('../vendor/highlight.js/lib/languages/swift'), lua: require('../vendor/highlight.js/lib/languages/lua'),
  perl: require('../vendor/highlight.js/lib/languages/perl'), r: require('../vendor/highlight.js/lib/languages/r'),
  scala: require('../vendor/highlight.js/lib/languages/scala'), latex: require('../vendor/highlight.js/lib/languages/latex'),
  cmake: require('../vendor/highlight.js/lib/languages/cmake'), nginx: require('../vendor/highlight.js/lib/languages/nginx'),
  protobuf: require('../vendor/highlight.js/lib/languages/protobuf'), graphql: require('../vendor/highlight.js/lib/languages/graphql'),
  dos: require('../vendor/highlight.js/lib/languages/dos'),
};
for (const l of LANGS) hljs.registerLanguage(l, MODS[l]);
hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: false });

const ALIAS = {
  py: 'python', python3: 'python', py3: 'python', ipython: 'python', ipython3: 'python', pycon: 'python-repl', pytb: 'python', numpy: 'python',
  js: 'javascript', node: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'bash', zsh: 'bash', console: 'shell',
  'shell-session': 'shell', bat: 'dos', batch: 'dos', cmd: 'dos', ps1: 'powershell', pwsh: 'powershell', yml: 'yaml', toml: 'ini', cfg: 'ini',
  dosini: 'ini', html: 'xml', xhtml: 'xml', svg: 'xml', 'html+jinja': 'xml', jinja: 'xml', 'html+django': 'xml', django: 'xml', 'c++': 'cpp',
  cxx: 'cpp', h: 'c', hpp: 'cpp', rs: 'rust', golang: 'go', postgres: 'pgsql', postgresql: 'pgsql', psql: 'pgsql', mysql: 'sql', sqlite3: 'sql',
  patch: 'diff', udiff: 'diff', docker: 'dockerfile', make: 'makefile', md: 'markdown', rb: 'ruby', cs: 'csharp', 'c#': 'csharp', kt: 'kotlin',
  tex: 'latex', proto: 'protobuf', jsonc: 'json', json5: 'json', javascriptreact: 'javascript',
};
const NONE = new Set(['', 'none', 'text', 'txt', 'rst', 'restructuredtext', 'default', 'output']);

/** Highlighted HTML, or null when the language is unknown or the block is very large (then it is shown plain). */
function highlight(code, lang) {
  const l = String(lang || '').toLowerCase().trim();
  if (NONE.has(l) || code.length > 300000) return null;
  const name = hljs.getLanguage(l) ? l : ALIAS[l];
  if (!name || !hljs.getLanguage(name)) return null;
  return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
}

module.exports = { highlight, LANGS };
