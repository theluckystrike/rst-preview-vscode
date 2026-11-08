'use strict';
// Bundles the extension host (src/ with the RST renderer and highlight.js) with esbuild. media/preview.js ships as is.
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const prod = process.argv.includes('--production');
(async () => {
  await esbuild.build({ entryPoints: ['src/extension.js'], outfile: 'dist/extension.js', bundle: true, minify: prod, sourcemap: false, legalComments: 'none', logLevel: 'warning',
    absWorkingDir: root, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] });
  console.log(`built: extension ${(fs.statSync(path.join(root, 'dist', 'extension.js')).size / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e); process.exit(1); });
