'use strict';
// Local paths written in a document (include, literalinclude, csv-table :file:, image, links) are resolved here.
// Nothing outside the root folder (the workspace folder, else the folder of the file) is ever read.
const fs = require('fs');
const path = require('path');

function realOrNull(p) { try { return fs.realpathSync(p); } catch { return null; } }
function inside(child, parent) { const rel = path.relative(parent, child); return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel)); }

/**
 * Resolves a path written in the document (include, image, link) against the file that contains it.
 * "/x" means the root folder (Sphinx style). Returns { file } or { error }. Never leaves the root folder.
 */
function resolveLocal(target, fromFile, root) {
  if (!root) return { error: 'the file is not on disk, so local files are not read' };
  const rootReal = realOrNull(root) || root;
  const clean = decodeURIComponentSafe(String(target).split('#')[0].split('?')[0]);
  if (!clean || clean.includes('\0')) return { error: 'empty path' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) && !/^[a-z]:[\\/]/i.test(clean)) return { error: 'not a local path' };
  const base = fromFile ? path.dirname(fromFile) : root;
  const abs = clean.startsWith('/') || clean.startsWith('\\') ? path.join(rootReal, clean) : path.resolve(base, clean);
  if (!inside(path.resolve(abs), rootReal) && !inside(path.resolve(abs), root)) return { error: `outside the workspace folder (refused): ${clean}` };
  const real = realOrNull(abs);
  if (!real) return { error: `file not found: ${clean}` };
  if (!inside(real, rootReal)) return { error: `outside the workspace folder (refused): ${clean}` };
  return { file: real };
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

module.exports = { resolveLocal, realOrNull, inside };
