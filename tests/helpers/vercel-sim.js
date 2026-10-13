'use strict';
/*
 * A small local imitation of how Vercel serves this project, used by the browser
 * checks. It is not a replacement for `vercel dev`; it covers the parts this site
 * relies on: public/ as the output folder, cleanUrls, trailingSlash:false,
 * 404.html for unknown paths, the headers in vercel.json, and the api/ functions
 * called with a JSON-parsed req.body.
 *
 *   node tests/helpers/vercel-sim.js <port> <full|bare|static>
 *     full = a (fake) Redis and Resend are configured, bare = api/ deployed but nothing configured,
 *     static = no api/ folder at all (the API paths return 404)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeEndpoint } = require('../../lib/endpoints');
const { createFakeServices, REDIS_ENV, MAIL_ENV } = require('./fake-redis');

const ROOT = path.resolve(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

function createSim(mode) {
  const svc = createFakeServices();
  const env = mode === 'full' ? Object.assign({}, REDIS_ENV, MAIL_ENV) : {};
  // static = the repository has no api/ folder, so the API paths simply do not exist
  const api = mode === 'static' ? {} : { '/api/orders': makeEndpoint('order', env, svc.fetch), '/api/enquiries': makeEndpoint('enquiry', env, svc.fetch) };
  const rules = (VERCEL.headers || []).map((h) => ({ re: new RegExp('^' + h.source.replace('(.*)', '.*') + '$'), headers: h.headers }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    rules.forEach((r) => r.re.test(p) && r.headers.forEach((h) => res.setHeader(h.key, h.value)));

    // test-only: what the fake Redis and Resend recorded
    if (p === '/__state') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ emails: svc.resend, keys: Array.from(svc.kv.keys()) })); }

    if (api[p]) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      if (/application\/json/.test(req.headers['content-type'] || '')) {
        // Vercel parses JSON lazily and throws on invalid JSON when req.body is read
        Object.defineProperty(req, 'body', { get() { return JSON.parse(raw.toString('utf8')); } });
      } else req.body = raw;
      return api[p](req, res);
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }

    // cleanUrls + trailingSlash:false
    const redirect = (to) => { res.statusCode = 308; res.setHeader('Location', to + url.search); res.end(); };
    if (p === '/index.html') return redirect('/');
    if (p.endsWith('.html') && p !== '/404.html') return redirect(p.slice(0, -5));
    if (p.length > 1 && p.endsWith('/')) return redirect(p.slice(0, -1));

    let file = p === '/' ? '/index.html' : p;
    let target = path.join(PUB, file);
    if (!target.startsWith(PUB)) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = fs.existsSync(target + '.html') ? target + '.html' : null;
    if (!target) {
      res.statusCode = 404;
      res.setHeader('Content-Type', TYPES['.html']);
      return res.end(fs.readFileSync(path.join(PUB, '404.html')));
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[path.extname(target)] || 'application/octet-stream');
    res.end(fs.readFileSync(target));
  });
  return { server, svc };
}

if (require.main === module) {
  const port = +process.argv[2] || 8110, mode = ['bare', 'static'].includes(process.argv[3]) ? process.argv[3] : 'full';
  createSim(mode).server.listen(port, () => console.log('vercel-sim ' + mode + ' on http://localhost:' + port));
}

module.exports = { createSim };
