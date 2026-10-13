'use strict';
/*
 * Minimal order server (Node 18+, no dependencies).
 *
 *   node server/server.js
 *
 * Serves the site files from PUBLIC_DIR and accepts orders at POST /api/orders.
 * Environment variables: see README.md (PORT, ORDERS_DIR, UPLOADS_DIR,
 * RESEND_API_KEY, FROM_EMAIL, BUSINESS_EMAIL, SEND_CUSTOMER_ACK, ALLOWED_ORIGIN).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(ROOT, 'public'));
const CAT = require(path.join(PUBLIC_DIR, 'hamper-catalogue.js'));
const P = require(path.join(PUBLIC_DIR, 'hamper-pricing.js'));
const { createOrderHandler } = require('./order-handler');
const { createFileStore, createFileUploads } = require('./storage');
const { createMailer } = require('./mailer');
const { createEnquiryHandler } = require('./enquiry-handler');

const PORT = +(process.env.PORT || 8080);
const MAX_BODY = 4 * 1024 * 1024; // logo up to 2 MB, base64 adds a third
const store = createFileStore(path.resolve(process.env.ORDERS_DIR || path.join(ROOT, 'data', 'orders')));
const uploads = createFileUploads(path.resolve(process.env.UPLOADS_DIR || path.join(ROOT, 'data', 'uploads')));
const mailer = createMailer(process.env);
const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer, uploads, options: { sendCustomerAck: process.env.SEND_CUSTOMER_ACK !== 'false' } });
const enquiryStore = createFileStore(path.resolve(process.env.ENQUIRIES_DIR || path.join(ROOT, 'data', 'enquiries')));
const handleEnquiry = createEnquiryHandler({ store: enquiryStore, mailer, options: { sendCustomerAck: process.env.SEND_CUSTOMER_ACK !== 'false', businessName: CAT.meta.business } });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.woff2': 'font/woff2', '.avif': 'image/avif' };

// simple per-IP limit: 10 order submissions per 10 minutes
const hits = new Map();
function limited(ip) {
  const t = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((x) => t - x < win);
  list.push(t);
  hits.set(ip, list);
  return list.length > 10;
}

function send(res, status, body, headers) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(data);
}

function cors(req) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (!allowed || req.headers.origin !== allowed) return {};
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/enquiries') {
      if (req.method === 'OPTIONS') return send(res, 204, '', cors(req));
      if (req.method !== 'POST') return send(res, 405, { ok: false, errors: [{ message: 'Use POST.' }] });
      const ip2 = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited('enq:' + ip2)) return send(res, 429, { ok: false, errors: [{ message: 'Too many requests. Please wait a few minutes and try again.' }] }, cors(req));
      let body2;
      try { body2 = await readJson(req); } catch (e) { return send(res, e.status || 400, { ok: false, errors: [{ message: 'The request was not understood.' }] }, cors(req)); }
      const out2 = await handleEnquiry(body2);
      if (out2.status === 201) console.log('[enquiry]', out2.body.reference, 'email:', out2.body.emailStatus);
      return send(res, out2.status, out2.body, cors(req));
    }

    if (url.pathname === '/api/orders') {
      if (req.method === 'OPTIONS') return send(res, 204, '', cors(req));
      if (req.method !== 'POST') return send(res, 405, { ok: false, errors: [{ message: 'Use POST.' }] });
      if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, errors: [{ message: 'Send JSON.' }] });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { ok: false, errors: [{ message: 'Too many requests. Please wait a few minutes and try again.' }] }, cors(req));
      let body;
      try { body = await readJson(req); } catch (e) {
        return send(res, e.status || 400, { ok: false, errors: [{ message: e.status === 413 ? 'The request is too large. Use a logo under 2 MB.' : 'The request was not understood.' }] }, cors(req));
      }
      const out = await handle(body);
      if (out.status === 201) console.log('[order]', out.body.reference, 'email:', out.body.emailStatus, 'customer:', out.body.customerEmailStatus);
      return send(res, out.status, out.body, cors(req));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false });

    // The page's settings: point the browser at this server's order API.
    if (url.pathname === '/home-config.js') {
      const base2 = await fs.promises.readFile(path.join(PUBLIC_DIR, 'home-config.js'), 'utf8');
      return send(res, 200, base2 + "\nwindow.KORE_SITE_CONFIG.enquiryEndpoint = '/api/enquiries';\n", { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    }
    if (url.pathname === '/hamper-config.js') {
      const base = await fs.promises.readFile(path.join(PUBLIC_DIR, 'hamper-config.js'), 'utf8');
      return send(res, 200, base + "\nwindow.KORE_HAMPER_CONFIG.orderEndpoint = '/api/orders';\n", { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (rel === '/customize-hamper') rel = '/customize-hamper.html';
    const file = path.resolve(PUBLIC_DIR, '.' + rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { ok: false });
    const data = await fs.promises.readFile(file).catch(() => null);
    if (!data) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return send(res, 200, data, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, errors: [{ message: 'Something went wrong on our side. Please try again.' }] });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('KORE hamper server on http://localhost:' + PORT + ' · email ' + (mailer ? 'configured' : 'NOT configured (orders are saved, emails skipped)'));
  });
}

module.exports = { server };
