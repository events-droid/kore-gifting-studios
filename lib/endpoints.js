'use strict';
/*
 * The two API endpoints as plain Node (req, res) functions, so they run on
 * Vercel and in tests without any framework.
 *
 *   POST /api/orders      the hamper builder's quotation request
 *   POST /api/enquiries   the homepage enquiry form
 *
 * Behaviour matches server/server.js (the self-hosted version):
 * validate, re-price on the server, save, then email KORE (and the customer).
 * When no database is configured they answer 503 { code: 'not_configured' }
 * and the pages fall back to a ready-to-send email draft.
 */
const CAT = require('../public/hamper-catalogue.js');
const P = require('../public/hamper-pricing.js');
const { createOrderHandler } = require('../server/order-handler');
const { createEnquiryHandler } = require('../server/enquiry-handler');
const { createMailer } = require('../server/mailer');
const { createRedis, createRedisStore, createRedisUploads, rateLimited } = require('./redis');

const MAX_PER_WINDOW = 10;
const WINDOW_SECONDS = 600; // 10 minutes

function send(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.keys(headers || {}).forEach((k) => res.setHeader(k, headers[k]));
  res.end(data);
}

const err = (message) => ({ ok: false, errors: [{ message }] });

function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
}

/** Vercel parses JSON bodies into req.body; fall back to reading the stream. */
async function readJson(req) {
  let body;
  try { body = req.body; } catch (e) { throw Object.assign(new Error('bad json'), { status: 400 }); }
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
    body = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { throw Object.assign(new Error('bad json'), { status: 400 }); } }
  return body;
}

function makeEndpoint(kind, env, fetchImpl) {
  const redis = createRedis(env, fetchImpl);
  const mailer = createMailer(env, fetchImpl);
  const sendCustomerAck = env.SEND_CUSTOMER_ACK !== 'false';
  let handle = null;
  if (redis) {
    if (kind === 'order') {
      handle = createOrderHandler({
        catalogue: CAT, pricing: P, mailer, options: { sendCustomerAck },
        store: createRedisStore(redis, 'order'),
        uploads: createRedisUploads(redis, { canDeliverByEmail: !!mailer })
      });
    } else {
      handle = createEnquiryHandler({
        mailer, store: createRedisStore(redis, 'enquiry'),
        options: { sendCustomerAck, businessName: CAT.meta.business }
      });
    }
  }

  return async function endpoint(req, res) {
    try {
      if (req.method !== 'POST') return send(res, 405, err('Use POST.'), { Allow: 'POST' });
      if (!handle) return send(res, 503, Object.assign(err('Online saving is not set up yet. Use the email draft to send your request.'), { code: 'not_configured' }));
      if (kind === 'order' && !/application\/json/.test((req.headers && req.headers['content-type']) || '')) return send(res, 415, err('Send JSON.'));
      let limited = false;
      try { limited = await rateLimited(redis, kind + ':' + clientIp(req), MAX_PER_WINDOW, WINDOW_SECONDS); } catch (e) { /* if the limiter fails, do not block real customers */ }
      if (limited) return send(res, 429, err('Too many requests. Please wait a few minutes and try again.'));
      let body;
      try { body = await readJson(req); } catch (e) {
        return send(res, e.status || 400, err(e.status === 413 ? 'The request is too large. Use a logo under 2 MB.' : 'The request was not understood.'));
      }
      const out = await handle(body);
      if (out.status === 201) console.log('[' + kind + ']', out.body.reference, 'email:', out.body.emailStatus);
      return send(res, out.status, out.body);
    } catch (e) {
      console.error('[' + kind + '] unexpected error', e && e.message);
      return send(res, 500, err('Something went wrong on our side. Please try again.'));
    }
  };
}

module.exports = { makeEndpoint, readJson, clientIp };
