'use strict';
/* Run with: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CAT = require('../public/hamper-catalogue.js');
const P = require('../public/hamper-pricing.js');
const { createOrderHandler } = require('../server/order-handler');
const { createFileStore, createFileUploads } = require('../server/storage');
const { createMailer } = require('../server/mailer');
const { retryAll } = require('../server/retry-emails');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FIXED_NOW = () => new Date('2026-10-09T10:00:00Z');

function cfg(extra) {
  const c = P.defaultConfig(CAT);
  c.items = [P.makeItem(CAT, 'notebook'), P.makeItem(CAT, 'steel-bottle')];
  if (extra) extra(c);
  return P.normalize(c, CAT).config;
}
const customer = { name: 'Priya Shah', email: 'priya@example.com', phone: '+91 98765 43210', company: 'Acme', acceptQuote: true };
function tmpDirs() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kore-'));
  return { store: createFileStore(path.join(d, 'orders')), uploads: createFileUploads(path.join(d, 'uploads')), dir: d };
}
function fakeMailer(failFor) {
  const sent = [];
  return { sent, async send(m) { if (failFor && failFor.includes(m.audience)) throw new Error('SMTP down'); sent.push(m); return { id: 'm' + sent.length }; } };
}

/* ---------------- pricing ---------------- */
test('per-hamper price is the sum of its parts', () => {
  const c = cfg();
  const pr = P.computePrice(c, CAT);
  // square box medium 420 + shredded paper 40*1.4=56 + notebook 349 + bottle 549
  assert.equal(pr.perHamper, 420 + 56 + 349 + 549);
  assert.equal(pr.grandTotal, pr.perHamper);
});

test('quantities multiply: 2 notebooks per hamper x 50 hampers = 100 notebooks', () => {
  const c = cfg((x) => { x.items[0].qty = 2; x.hampers = 50; });
  const pr = P.computePrice(c, CAT);
  const nb = pr.productTotals.find((t) => t.productId === 'notebook');
  assert.equal(nb.perHamper, 2);
  assert.equal(nb.total, 100);
  assert.equal(pr.subtotal, pr.perHamper * 50);
});

test('removing an item deducts its price', () => {
  const c = cfg();
  const before = P.computePrice(c, CAT).perHamper;
  c.items = c.items.filter((i) => i.productId !== 'steel-bottle');
  assert.equal(P.computePrice(c, CAT).perHamper, before - 549);
});

test('personalisation is charged per item and only when it has content', () => {
  const c = cfg((x) => { x.items[1].qty = 2; x.items[1].personal.on = true; x.items[1].personal.method = 'engrave'; });
  let pr = P.computePrice(c, CAT);
  assert.equal(pr.groups.personal, 0, 'switched on but empty: no charge');
  assert.ok(P.validate(c, CAT).errors.some((e) => /Add text or a logo/.test(e.message)));
  c.items[1].personal.text = 'Priya';
  pr = P.computePrice(c, CAT);
  assert.equal(pr.groups.personal, 90 * 2);
});

test('variant surcharge and material upgrade are included', () => {
  const c = cfg((x) => { x.items[0].variant = 'B5'; x.lining = 'suede'; });
  const pr = P.computePrice(c, CAT);
  assert.ok(pr.lines.some((l) => l.label === 'Suede-feel lining' && l.amount === 90));
  assert.ok(pr.lines.some((l) => /Hardbound notebook \(B5\)/.test(l.label) && l.unit === 409));
});

test('tax, delivery and bulk tiers apply only when configured', () => {
  const c = cfg((x) => { x.hampers = 100; });
  let pr = P.computePrice(c, CAT);
  assert.equal(pr.tax, null); assert.equal(pr.delivery, null); assert.equal(pr.bulkTier, null);
  const cat2 = JSON.parse(JSON.stringify(CAT));
  cat2.pricing.taxRate = 0.18; cat2.pricing.deliveryCharge = 500; cat2.pricing.bulkTiers = [{ minHampers: 50, discountPct: 5 }, { minHampers: 100, discountPct: 8 }];
  pr = P.computePrice(c, cat2);
  assert.equal(pr.bulkTier.discountPct, 8);
  assert.equal(pr.discountPerHamper, Math.round(pr.perHamper * 0.08));
  assert.equal(pr.subtotal, (pr.perHamper - pr.discountPerHamper) * 100);
  assert.equal(pr.tax, Math.round(pr.subtotal * 0.18));
  assert.equal(pr.grandTotal, pr.subtotal + pr.tax + 500);
});

/* ---------------- rules ---------------- */
test('quantities are clamped: no negatives, no more than allowed', () => {
  const c = cfg((x) => { x.items[0].qty = -4; x.items[1].qty = 99; x.hampers = -3; });
  assert.equal(c.items[0].qty, 1);
  assert.equal(c.items[1].qty, P.findProduct(CAT, 'steel-bottle').maxPerHamper);
  assert.equal(c.hampers, 1);
});

test('changing the box keeps compatible choices and explains the rest', () => {
  const c = cfg((x) => { x.finishing = ['ribbon-satin', 'bow', 'sleeve', 'wax-seal']; x.colours.ribbon = 'gold'; x.hamper.placement = 'lid'; });
  c.boxId = 'canvas-bag';
  const r = P.normalize(c, CAT);
  assert.deepEqual(r.config.finishing, ['ribbon-satin', 'bow']);
  assert.equal(r.config.colours.ribbon, 'gold');
  assert.equal(r.config.hamper.placement, 'front');
  assert.equal(r.config.items.length, 2);
  assert.ok(r.notices.some((n) => /sleeve/i.test(n)));
});

test('over-capacity and too-small boxes are errors, fragile-in-bag is a warning', () => {
  const c = cfg((x) => { x.size = 's'; x.items.push(P.makeItem(CAT, 'tshirt'), P.makeItem(CAT, 'mug')); x.items[0].qty = 3; });
  const v = P.validate(c, CAT);
  assert.ok(v.errors.some((e) => /spaces/.test(e.message)));
  assert.ok(v.errors.some((e) => /T-shirt needs a Medium/.test(e.message)));
  c.boxId = 'canvas-bag';
  P.normalize(c, CAT);
  assert.ok(P.validate(c, CAT).warnings.some((w) => /fragile/.test(w.message)));
});

test('a ribbon colour must suit the chosen ribbon; a bow needs a ribbon', () => {
  const c = cfg((x) => { x.finishing = ['bow']; });
  assert.deepEqual(c.finishing, []);
  const c2 = cfg((x) => { x.finishing = ['ribbon-grosgrain']; x.colours.ribbon = 'gold'; });
  assert.equal(c2.colours.ribbon, 'ivory');
});

test('customer validation', () => {
  const bad = P.validateCustomer(P.cleanCustomer({ name: 'A', email: 'nope', phone: '123', gstin: 'XYZ', deliveryDate: '2026-10-10' }), CAT, FIXED_NOW());
  assert.deepEqual(Object.keys(bad).sort(), ['acceptQuote', 'deliveryDate', 'email', 'gstin', 'name', 'phone']);
  const good = P.validateCustomer(P.cleanCustomer(Object.assign({ gstin: '27ABCDE1234F1Z5', deliveryDate: '2026-10-20' }, customer)), CAT, FIXED_NOW());
  assert.deepEqual(good, {});
});

/* ---------------- order handler ---------------- */
test('happy path: saved, re-priced on the server, both emails sent', async () => {
  const { store, uploads } = tmpDirs();
  const mailer = fakeMailer();
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer, uploads, now: FIXED_NOW });
  const c = cfg((x) => { x.hampers = 25; });
  const out = await handle({ config: c, customer, client: { grandTotal: P.computePrice(c, CAT).grandTotal } });
  assert.equal(out.status, 201);
  assert.match(out.body.reference, /^KORE-261009-[A-Z2-9]{5}$/);
  assert.equal(out.body.emailStatus, 'sent');
  assert.equal(out.body.customerEmailStatus, 'sent');
  const saved = await store.get(out.body.reference);
  assert.equal(saved.pricing.hampers, 25);
  assert.equal(saved.priceMismatch, false);
  assert.equal(mailer.sent[0].audience, 'business');
  assert.match(mailer.sent[0].text, /Units for the whole order/);
  assert.match(mailer.sent[0].text, /Hardbound notebook.*1 per hamper, 25 in total/);
  assert.equal(mailer.sent[1].to, 'priya@example.com');
});

test('a tampered browser price is ignored and flagged', async () => {
  const { store, uploads } = tmpDirs();
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer: fakeMailer(), uploads, now: FIXED_NOW });
  const c = cfg();
  const out = await handle({ config: c, customer, client: { grandTotal: 1 } });
  assert.equal(out.status, 201);
  assert.equal(out.body.pricing.grandTotal, P.computePrice(c, CAT).grandTotal);
  assert.equal(out.body.priceMismatch, true);
});

test('unknown products and invalid options are cleaned, invalid orders rejected', async () => {
  const { store, uploads } = tmpDirs();
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer: null, uploads, now: FIXED_NOW });
  const c = cfg();
  c.items.push({ productId: 'gold-bar', qty: 5 });
  c.items[0].colour = 'neon';
  let out = await handle({ config: c, customer });
  assert.equal(out.status, 201);
  const saved = await store.get(out.body.reference);
  assert.equal(saved.config.items.length, 2);
  assert.equal(saved.config.items[0].colour, 'black');
  out = await handle({ config: cfg((x) => { x.items = []; }), customer });
  assert.equal(out.status, 422);
  out = await handle({ config: cfg(), customer: Object.assign({}, customer, { email: 'x' }) });
  assert.equal(out.status, 422);
  assert.equal(out.body.errors[0].field, 'email');
  out = await handle({ config: cfg((x) => { x.hampers = 999999; }), customer });
  assert.equal(out.status, 422);
});

test('email not configured: order saved, status says so', async () => {
  const { store, uploads } = tmpDirs();
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer: createMailer({}), uploads, now: FIXED_NOW });
  const out = await handle({ config: cfg(), customer });
  assert.equal(out.status, 201);
  assert.equal(out.body.emailStatus, 'not_configured');
  assert.ok(await store.exists(out.body.reference));
});

test('email failure keeps the order, records the failure, and the retry sends it', async () => {
  const { store, uploads } = tmpDirs();
  const broken = fakeMailer(['business']);
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer: broken, uploads, now: FIXED_NOW });
  const out = await handle({ config: cfg(), customer });
  assert.equal(out.status, 201);
  assert.equal(out.body.emailStatus, 'failed');
  let saved = await store.get(out.body.reference);
  assert.equal(saved.email.business.status, 'failed');
  assert.match(saved.email.business.error, /SMTP down/);
  const fixed = fakeMailer();
  await retryAll({ store, uploads, mailer: fixed, log: () => {} });
  saved = await store.get(out.body.reference);
  assert.equal(saved.email.business.status, 'sent');
  assert.equal(saved.email.business.attempts, 2);
  assert.equal(fixed.sent.filter((m) => m.audience === 'business').length, 1);
});

test('storage failure: error returned, no email sent', async () => {
  const { uploads } = tmpDirs();
  const mailer = fakeMailer();
  const store = { exists: async () => false, save: async () => { throw new Error('disk full'); }, update: async () => {} };
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer, uploads, now: FIXED_NOW });
  const out = await handle({ config: cfg(), customer });
  assert.equal(out.status, 500);
  assert.equal(out.body.ok, false);
  assert.equal(mailer.sent.length, 0);
});

test('logos: required when used, type checked by content, saved under a generated name', async () => {
  const { store, uploads, dir } = tmpDirs();
  const mailer = fakeMailer();
  const handle = createOrderHandler({ catalogue: CAT, pricing: P, store, mailer, uploads, now: FIXED_NOW });
  const c = cfg((x) => { x.hamper.useLogo = true; });
  let out = await handle({ config: c, customer });
  assert.equal(out.status, 422);
  out = await handle({ config: c, customer, logo: { name: '../../evil.png', data: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') } });
  assert.equal(out.status, 422, 'content that is not a PNG is refused');
  out = await handle({ config: c, customer, logo: { name: '../../evil.png', data: PNG } });
  assert.equal(out.status, 201);
  const saved = await store.get(out.body.reference);
  assert.match(saved.logo.file, /^KORE-261009-[A-Z2-9]{5}-logo-[0-9a-f]{8}\.png$/);
  assert.equal(saved.logo.originalName, '.._.._evil.png');
  assert.ok(fs.existsSync(path.join(dir, 'uploads', saved.logo.file)));
  assert.equal(mailer.sent[0].attachments.length, 1);
});

test('Resend mailer sends the right request and surfaces provider errors', async () => {
  const calls = [];
  const ok = createMailer({ RESEND_API_KEY: 'k', FROM_EMAIL: 'KORE <o@x.in>', BUSINESS_EMAIL: 'a@x.in, b@x.in' }, async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ id: 'abc' }) }; });
  const r = await ok.send({ audience: 'business', subject: 's', text: 't', html: 'h', replyTo: 'c@y.in' });
  assert.equal(r.id, 'abc');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ['a@x.in', 'b@x.in']);
  assert.equal(body.reply_to, 'c@y.in');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  const bad = createMailer({ RESEND_API_KEY: 'k', FROM_EMAIL: 'f', BUSINESS_EMAIL: 'b' }, async () => ({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) }));
  await assert.rejects(bad.send({ audience: 'business', subject: 's', text: 't', html: 'h' }), /403: domain not verified/);
});

/* ---------------- enquiries ---------------- */
const { createEnquiryHandler } = require('../server/enquiry-handler');
test('enquiry: validated, saved, emailed; failures recorded truthfully', async () => {
  const { store } = tmpDirs();
  const mailer = fakeMailer();
  const handle = createEnquiryHandler({ store, mailer, now: FIXED_NOW });
  let out = await handle({ name: 'P', email: 'nope' });
  assert.equal(out.status, 422);
  assert.deepEqual(out.body.errors.map((e) => e.field), ['name', 'email']);
  out = await handle({ occasion: 'Wedding', quantity: '100 to 499', name: 'Priya Shah', email: 'priya@example.com', company: 'Acme' });
  assert.equal(out.status, 201);
  assert.match(out.body.reference, /^ENQ-261009-[A-Z2-9]{5}$/);
  assert.equal(out.body.emailStatus, 'sent');
  const saved = await store.get(out.body.reference);
  assert.equal(saved.occasion, 'Wedding');
  assert.equal(saved.notifications.customer.status, 'sent');
  assert.match(mailer.sent[0].text, /Recipients: 100 to 499/);
  const broken = createEnquiryHandler({ store, mailer: fakeMailer(['business']), now: FIXED_NOW });
  out = await broken({ occasion: 'Hacked', quantity: 'lots', name: 'Ravi K', email: 'ravi@example.com' });
  assert.equal(out.status, 201);
  assert.equal(out.body.emailStatus, 'failed');
  const s2 = await store.get(out.body.reference);
  assert.equal(s2.occasion, 'Other');
  assert.equal(s2.quantity, 'Under 25');
  const none = createEnquiryHandler({ store, mailer: null, now: FIXED_NOW });
  out = await none({ name: 'Ravi K', email: 'ravi@example.com' });
  assert.equal(out.body.emailStatus, 'not_configured');
});
