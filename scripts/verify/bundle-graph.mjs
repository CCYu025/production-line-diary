// Static-import graph analysis of a Vite build (web/dist). Shared by os-bundle.mjs and os-perf.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const CONTENT_MARKERS = ['__THREE__', 'WebGLRenderer', 'WebGLRenderTarget', '@react-three', 'BufferGeometry', 'WebGLProgram'];
export const NAME_RE = /three|fiber|OsShell|features[\\/]os/i;

const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1];

// Static import/export-from in minified ESM. Not dynamic import(...), not __vitePreload dependency arrays.
const STATIC_RE = /(?<![\w$.])(?:import|export)\s*(?:[^"'`()]*?\s*from\s*)?["']([^"']+?\.js)["']/g;

export function analyze(distArg) {
  const dist = path.resolve(distArg);
  const indexFile = path.join(dist, 'index.html');
  if (!fs.existsSync(indexFile)) throw new Error(`${indexFile} not found (build web first)`);
  const html = fs.readFileSync(indexFile, 'utf8');
  const rel = (abs) => path.relative(dist, abs).replace(/\\/g, '/');
  const resolveDist = (href, fromDir = dist) => {
    const clean = href.split(/[?#]/)[0];
    return clean.startsWith('/') ? path.join(dist, clean) : path.resolve(fromDir, clean);
  };
  const entries = []; const cssFiles = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) if (/type\s*=\s*["']module["']/i.test(m[0]) && attr(m[0], 'src')) entries.push(resolveDist(attr(m[0], 'src')));
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const r = (attr(m[0], 'rel') || '').toLowerCase(); const h = attr(m[0], 'href'); if (!h) continue;
    if (r === 'modulepreload') entries.push(resolveDist(h));
    else if (r === 'stylesheet') cssFiles.push(resolveDist(h));
  }
  if (!entries.length) throw new Error('no module entry script found in index.html');

  const warnings = [];
  const staticImports = (file) => {
    const src = fs.readFileSync(file, 'utf8'); const out = [];
    for (const m of src.matchAll(STATIC_RE)) { if (/^(\.|\/)/.test(m[1])) out.push(resolveDist(m[1], path.dirname(file))); }
    return out;
  };
  const closure = (seeds, exclude = new Set()) => {
    const seen = new Set(); const stack = [...seeds];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f) || exclude.has(f)) continue;
      if (!fs.existsSync(f)) { warnings.push(`missing chunk referenced: ${rel(f)}`); continue; }
      seen.add(f);
      for (const d of staticImports(f)) stack.push(d);
    }
    return seen;
  };
  const staticGraph = closure(entries);
  const allJs = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name)) allJs.push(p); } })(dist);
  const lazyJs = allJs.filter((f) => !staticGraph.has(f)).sort();
  const markersOf = (f) => { const src = fs.readFileSync(f, 'utf8'); return CONTENT_MARKERS.filter((k) => src.includes(k)); };
  const isOsish = (f) => NAME_RE.test(path.basename(f)) || markersOf(f).length > 0;
  const osLazy = closure(lazyJs.filter(isOsish), staticGraph);
  return { dist, rel, cssFiles, staticGraph, lazyJs, osLazy, markersOf, warnings };
}
