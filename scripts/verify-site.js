'use strict';
/*
 * Pre-deploy check (npm run check). Vercel does NOT run this: the site has no
 * compile step and is served as-is from public/. Run it on your computer, or in
 * CI, before you push, so a broken link or script is caught early:
 *   - every local file the HTML, CSS and JS point at exists in public/
 *   - every script parses
 *   - vercel.json is valid JSON and points at a real output folder
 *   - the API functions in api/ load (only if that folder is present; it is optional)
 * Exits with an error (and so fails the Vercel build) if anything is wrong.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const problems = [];
let checked = 0;

function exists(rel, from) {
  const clean = rel.split('#')[0].split('?')[0];
  if (!clean) return true;
  const base = clean.startsWith('/') ? PUB : path.dirname(from);
  checked++;
  return fs.existsSync(path.join(base, clean));
}
const isLocal = (u) => u && !/^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(u);

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const f = path.join(dir, d.name);
    if (d.isDirectory()) walk(f, out); else out.push(f);
  });
  return out;
}
const files = walk(PUB, []);

// HTML: src / href that point at local files
files.filter((f) => f.endsWith('.html')).forEach((f) => {
  const html = fs.readFileSync(f, 'utf8');
  const re = /\b(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (!isLocal(u) || /\.html$/.test(u.split('#')[0]) === false && !/\.[a-z0-9]+$/i.test(u.split('#')[0])) continue;
    if (!exists(u, f)) problems.push(path.relative(ROOT, f) + ': missing ' + u);
  }
});

// CSS: url(...)
files.filter((f) => f.endsWith('.css')).forEach((f) => {
  const css = fs.readFileSync(f, 'utf8');
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(css))) if (isLocal(m[1]) && !exists(m[1], f)) problems.push(path.relative(ROOT, f) + ': missing ' + m[1]);
});

// JS: parses, and quoted references to img/ and vendor/ files exist
files.filter((f) => f.endsWith('.js')).forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  try { new vm.Script(src, { filename: f }); } catch (e) { problems.push(path.relative(ROOT, f) + ': syntax error: ' + e.message); }
  if (f.includes(path.sep + 'vendor' + path.sep)) return;
  const re = /['"]((?:img|vendor)\/[A-Za-z0-9_./-]+\.[a-z0-9]+)['"]/g;
  let m;
  while ((m = re.exec(src))) if (!exists('/' + m[1], f)) problems.push(path.relative(ROOT, f) + ': missing ' + m[1]);
});

// vercel.json
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  if (cfg.outputDirectory && !fs.existsSync(path.join(ROOT, cfg.outputDirectory, 'index.html'))) problems.push('vercel.json: outputDirectory has no index.html');
} catch (e) { problems.push('vercel.json: ' + e.message); }

// API functions (optional): if the api/ folder is in the repository, every function must load.
// If it is not, the site deploys as a static site and the pages use the email draft.
const apiDir = path.join(ROOT, 'api');
const apiFiles = fs.existsSync(apiDir) ? fs.readdirSync(apiDir).filter((n) => n.endsWith('.js')) : [];
apiFiles.forEach((n) => {
  try { if (typeof require(path.join(apiDir, n)) !== 'function') problems.push('api/' + n + ' does not export a function'); }
  catch (e) { problems.push('api/' + n + ': ' + e.message + ' (the lib/ and server/ folders must be in the repository too)'); }
});
const apiNote = apiFiles.length ? apiFiles.length + ' API functions load' : 'no api/ functions in this repository: deploying as a static site (orders and enquiries use the email draft)';

if (problems.length) {
  console.error('Site check failed:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('Site check passed: ' + files.length + ' files in public/, ' + checked + ' local references verified, ' + apiNote + '.');
