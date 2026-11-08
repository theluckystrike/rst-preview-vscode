// Renders files with RST Preview's renderer to one JSON (name -> HTML). Dev and gate tool.
'use strict';
const fs = require('fs');
const path = require('path');
const { renderRst } = require('../src/core/rst');
const { highlight } = require('../src/highlight');
const out = {};
for (const f of process.argv.slice(3)) out[path.basename(f)] = renderRst(fs.readFileSync(f, 'utf8'), { fileName: path.basename(f), highlight, resolveImage: u => ({ src: u }) }).chunks.join('');
fs.writeFileSync(process.argv[2], JSON.stringify(out));
