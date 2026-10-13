'use strict';
/*
 * A tiny in-memory stand-in for the Upstash Redis REST API (and Resend), so the
 * API functions can be tested without a network. Supports the commands the
 * store uses: SET (NX), GET, EXISTS, ZADD, ZREVRANGE, MGET, INCR, EXPIRE.
 * Pass `fetch` as the fetch implementation. `resend` collects emails sent.
 */
function createFakeServices(opts = {}) {
  const kv = new Map();
  const zsets = new Map();
  const resend = [];
  const state = { redisDown: false, resendStatus: 200 };

  function run(a) {
    const [cmd, ...r] = a;
    switch (String(cmd).toUpperCase()) {
      case 'SET': {
        const nx = r.slice(2).includes('NX');
        if (nx && kv.has(r[0])) return null;
        kv.set(r[0], String(r[1]));
        return 'OK';
      }
      case 'GET': return kv.has(r[0]) ? kv.get(r[0]) : null;
      case 'EXISTS': return kv.has(r[0]) ? 1 : 0;
      case 'ZADD': { const z = zsets.get(r[0]) || []; z.push({ score: Number(r[1]), member: r[2] }); zsets.set(r[0], z); return 1; }
      case 'ZREVRANGE': {
        const z = (zsets.get(r[0]) || []).slice().sort((x, y) => y.score - x.score).map((e) => e.member);
        const end = Number(r[2]) < 0 ? z.length : Number(r[2]) + 1;
        return z.slice(Number(r[1]), end);
      }
      case 'MGET': return r.map((k) => (kv.has(k) ? kv.get(k) : null));
      case 'INCR': { const n = (Number(kv.get(r[0])) || 0) + 1; kv.set(r[0], String(n)); return n; }
      case 'EXPIRE': return 1;
      default: throw new Error('ERR unknown command ' + cmd);
    }
  }
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  async function fetch(url, init) {
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (/api\.resend\.com/.test(url)) {
      if (state.resendStatus !== 200) return res(state.resendStatus, { message: 'resend refused' });
      resend.push(body);
      return res(200, { id: 'em_' + resend.length });
    }
    if (state.redisDown) throw new Error('network down');
    if (!/^https:\/\/fake-redis\.test/.test(url)) return res(404, {});
    try { return res(200, { result: run(body) }); } catch (e) { return res(400, { error: e.message }); }
  }
  return { fetch, kv, zsets, resend, state };
}

const REDIS_ENV = { UPSTASH_REDIS_REST_URL: 'https://fake-redis.test', UPSTASH_REDIS_REST_TOKEN: 'token' };
const MAIL_ENV = { RESEND_API_KEY: 'rk', FROM_EMAIL: 'KORE <orders@example.in>', BUSINESS_EMAIL: 'koreexpression@gmail.com' };

/** Minimal Node-style req/res. `body` may be an object (as Vercel parses it), a string, or a Buffer. */
function mockReq(method, body, headers) {
  return { method, body, headers: Object.assign({ 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' }, headers || {}), socket: { remoteAddress: '127.0.0.1' } };
}
function mockRes() {
  const r = { statusCode: 200, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.end = (d) => { r.body = d || ''; r.done = true; };
  r.json = () => JSON.parse(r.body);
  return r;
}

module.exports = { createFakeServices, REDIS_ENV, MAIL_ENV, mockReq, mockRes };
