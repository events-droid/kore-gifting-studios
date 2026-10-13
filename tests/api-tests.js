'use strict';
/* Vercel API functions against a fake Redis and a fake Resend. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const CAT = require('../public/hamper-catalogue.js');
const P = require('../public/hamper-pricing.js');
const { makeEndpoint } = require('../lib/endpoints');
const { createRedis, createRedisStore, createRedisUploads, redisConfig, MAX_LOGO_STORE_BYTES } = require('../lib/redis');
const { retryAll } = require('../server/retry-emails');
const { createMailer } = require('../server/mailer');
const { createFakeServices, REDIS_ENV, MAIL_ENV, mockReq, mockRes } = require('./helpers/fake-redis');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const customer = { name: 'Priya Shah', email: 'priya@example.com', phone: '+91 98765 43210', company: 'Acme', acceptQuote: true };
function cfg(extra) {
  const c = P.defaultConfig(CAT);
  c.items = [P.makeItem(CAT, 'notebook'), P.makeItem(CAT, 'steel-bottle')];
  if (extra) extra(c);
  return P.normalize(c, CAT).config;
}
const orderBody = (c, extra) => Object.assign({ config: c, customer, client: { grandTotal: P.computePrice(c, CAT).grandTotal } }, extra || {});
async function call(endpoint, req) { const res = mockRes(); await endpoint(req, res); return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers }; }
function setup(kind, withMail = true) {
  const svc = createFakeServices();
  const env = Object.assign({}, REDIS_ENV, withMail ? MAIL_ENV : {});
  return Object.assign(svc, { endpoint: makeEndpoint(kind, env, svc.fetch), env });
}

test('redis settings: both Upstash and legacy KV names are understood', () => {
  assert.equal(redisConfig({}), null);
  assert.deepEqual(redisConfig({ KV_REST_API_URL: 'https://a.io/', KV_REST_API_TOKEN: 't' }), { url: 'https://a.io', token: 't' });
  assert.equal(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://b.io', UPSTASH_REDIS_REST_TOKEN: 't' }).url, 'https://b.io');
  assert.equal(createRedis({}), null);
});

test('without a database: 503 not_configured so the pages fall back to the email draft', async () => {
  for (const kind of ['order', 'enquiry']) {
    const ep = makeEndpoint(kind, {}, createFakeServices().fetch);
    const r = await call(ep, mockReq('POST', kind === 'order' ? orderBody(cfg()) : { name: 'Ravi K', email: 'r@x.in' }));
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'not_configured');
    assert.equal(r.body.ok, false);
  }
});

test('only POST is accepted', async () => {
  const { endpoint } = setup('order');
  const r = await call(endpoint, mockReq('GET'));
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, 'POST');
});

test('order: saved in Redis, re-priced, KORE and the customer emailed', async () => {
  const { endpoint, kv, resend } = setup('order');
  const c = cfg((x) => { x.hampers = 25; });
  const r = await call(endpoint, mockReq('POST', orderBody(c)));
  assert.equal(r.status, 201);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.body.reference, /^KORE-\d{6}-[A-Z2-9]{5}$/);
  assert.equal(r.body.emailStatus, 'sent');
  assert.equal(r.body.customerEmailStatus, 'sent');
  const saved = JSON.parse(kv.get('kore:order:' + r.body.reference));
  assert.equal(saved.pricing.hampers, 25);
  assert.equal(saved.priceMismatch, false);
  assert.equal(resend.length, 2);
  assert.deepEqual(resend[0].to, ['koreexpression@gmail.com']);
  assert.deepEqual(resend[1].to, ['priya@example.com']);
});

test('order: a tampered browser price is ignored and flagged', async () => {
  const { endpoint, kv } = setup('order');
  const c = cfg();
  const r = await call(endpoint, mockReq('POST', { config: c, customer, client: { grandTotal: 1 } }));
  assert.equal(r.status, 201);
  assert.equal(r.body.pricing.grandTotal, P.computePrice(c, CAT).grandTotal);
  assert.equal(r.body.priceMismatch, true);
  assert.equal(JSON.parse(kv.get('kore:order:' + r.body.reference)).priceMismatch, true);
});

test('order: bad input is rejected with the right status', async () => {
  const { endpoint } = setup('order');
  assert.equal((await call(endpoint, mockReq('POST', orderBody(cfg()), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await call(endpoint, mockReq('POST', '{not json'))).status, 400);
  assert.equal((await call(endpoint, mockReq('POST', { config: cfg(), customer: { name: 'P' } }))).status, 422);
  assert.equal((await call(endpoint, mockReq('POST', { nope: true }))).status, 400);
});

test('order: the body is also read from a raw stream when the platform has not parsed it', async () => {
  const { endpoint } = setup('order');
  const req = Readable.from([Buffer.from(JSON.stringify(orderBody(cfg())))]);
  Object.assign(req, { method: 'POST', headers: { 'content-type': 'application/json' }, socket: {} });
  const r = await call(endpoint, req);
  assert.equal(r.status, 201);
});

test('order: email failure keeps the order and says so; Redis outage is a clean 500', async () => {
  const s = setup('order');
  s.state.resendStatus = 403;
  let r = await call(s.endpoint, mockReq('POST', orderBody(cfg())));
  assert.equal(r.status, 201);
  assert.equal(r.body.emailStatus, 'failed');
  s.state.redisDown = true;
  r = await call(s.endpoint, mockReq('POST', orderBody(cfg())));
  assert.equal(r.status, 500);
  assert.equal(r.body.ok, false);
  assert.equal(JSON.stringify(r.body).includes('Error'), false, 'no internals leak');
});

test('order: no email configured is reported as not_configured, never as sent', async () => {
  const { endpoint, resend } = setup('order', false);
  const r = await call(endpoint, mockReq('POST', orderBody(cfg())));
  assert.equal(r.status, 201);
  assert.equal(r.body.emailStatus, 'not_configured');
  assert.equal(resend.length, 0);
});

test('rate limit: the 11th request in the window gets 429', async () => {
  const { endpoint } = setup('order');
  let last;
  for (let i = 0; i < 11; i++) last = await call(endpoint, mockReq('POST', orderBody(cfg())));
  assert.equal(last.status, 429);
  const other = await call(endpoint, mockReq('POST', orderBody(cfg()), { 'x-real-ip': '198.51.100.9' }));
  assert.equal(other.status, 201, 'another visitor is not blocked');
});

test('logo: stored in Redis when small, emailed as an attachment', async () => {
  const { endpoint, kv, resend } = setup('order');
  const c = cfg((x) => { x.hamper.useLogo = true; });
  const r = await call(endpoint, mockReq('POST', orderBody(c, { logo: { name: 'logo.png', data: PNG } })));
  assert.equal(r.status, 201);
  const saved = JSON.parse(kv.get('kore:order:' + r.body.reference));
  assert.match(saved.logo.file, /-logo-[0-9a-f]{8}\.png$/);
  assert.ok(kv.get('kore:logo:' + saved.logo.file).length > 10);
  assert.equal(resend[0].attachments.length, 1);
  // a logo that is not really a PNG is refused
  const bad = await call(endpoint, mockReq('POST', orderBody(c, { logo: { name: 'x.png', data: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') } })));
  assert.equal(bad.status, 422);
});

test('logo larger than the Redis limit: fine when email delivers it, refused when nothing could', async () => {
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX_LOGO_STORE_BYTES + 5000, 1)]);
  const logo = { name: 'big.png', data: 'data:image/png;base64,' + big.toString('base64') };
  const c = cfg((x) => { x.hamper.useLogo = true; });
  const withMail = setup('order', true);
  let r = await call(withMail.endpoint, mockReq('POST', orderBody(c, { logo })));
  assert.equal(r.status, 201);
  const saved = JSON.parse(withMail.kv.get('kore:order:' + r.body.reference));
  assert.equal(withMail.kv.has('kore:logo:' + saved.logo.file), false);
  assert.equal(withMail.resend[0].attachments.length, 1, 'KORE still receives the logo');
  const noMail = setup('order', false);
  r = await call(noMail.endpoint, mockReq('POST', orderBody(c, { logo })));
  assert.equal(r.status, 500);
});

test('enquiry: validated, saved in Redis, emailed', async () => {
  const { endpoint, kv, resend } = setup('enquiry');
  let r = await call(endpoint, mockReq('POST', { name: 'P', email: 'nope' }));
  assert.equal(r.status, 422);
  r = await call(endpoint, mockReq('POST', { occasion: 'Wedding', quantity: '100 to 499', name: 'Priya Shah', email: 'priya@example.com', company: 'Acme' }));
  assert.equal(r.status, 201);
  assert.match(r.body.reference, /^ENQ-\d{6}-[A-Z2-9]{5}$/);
  assert.equal(JSON.parse(kv.get('kore:enquiry:' + r.body.reference)).occasion, 'Wedding');
  assert.deepEqual(resend[0].to, ['koreexpression@gmail.com']);
  assert.match(resend[0].text, /Recipients: 100 to 499/);
});

test('Redis store: unique references, list is newest first, unsafe references refused', async () => {
  const svc = createFakeServices();
  const store = createRedisStore(createRedis(REDIS_ENV, svc.fetch), 'order');
  await store.save({ reference: 'KORE-A', createdAt: '2026-10-01T00:00:00Z' });
  await store.save({ reference: 'KORE-B', createdAt: '2026-10-03T00:00:00Z' });
  await store.save({ reference: 'KORE-C', createdAt: '2026-10-02T00:00:00Z' });
  await assert.rejects(store.save({ reference: 'KORE-A', createdAt: '2026-10-09T00:00:00Z' }), /already exists/);
  assert.equal(await store.exists('KORE-A'), true);
  assert.equal(await store.exists('KORE-Z'), false);
  assert.deepEqual((await store.list()).map((o) => o.reference), ['KORE-B', 'KORE-C', 'KORE-A']);
  await assert.rejects(store.get('../etc/passwd'), /Unsafe/);
  await assert.rejects(store.get('KORE-NOPE'), /Not found/);
});

test('retry-emails works on Redis: a failed email is resent, with the stored logo attached', async () => {
  const s = setup('order');
  s.state.resendStatus = 403;
  const c = cfg((x) => { x.hamper.useLogo = true; });
  const r = await call(s.endpoint, mockReq('POST', orderBody(c, { logo: { name: 'logo.png', data: PNG } })));
  assert.equal(r.body.emailStatus, 'failed');
  s.state.resendStatus = 200;
  const redis = createRedis(REDIS_ENV, s.fetch);
  const mailer = createMailer(MAIL_ENV, s.fetch);
  const n = await retryAll({ store: createRedisStore(redis, 'order'), uploads: createRedisUploads(redis, { canDeliverByEmail: true }), mailer, log: () => {} });
  assert.equal(n, 1);
  assert.equal(JSON.parse(s.kv.get('kore:order:' + r.body.reference)).email.business.status, 'sent');
  assert.equal(s.resend[0].attachments.length, 1);
});
