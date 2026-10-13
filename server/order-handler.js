'use strict';
/*
 * Order handling, independent of any web framework.
 *
 *   const handle = createOrderHandler({ catalogue, pricing, store, mailer, uploads, options });
 *   const { status, body } = await handle(requestJson);
 *
 * The browser's prices are never trusted: the configuration is normalised,
 * validated and re-priced here from the server's own catalogue.
 */
const crypto = require('crypto');
const { buildBusinessEmail, buildCustomerEmail } = require('./emails');

const MAGIC = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
};
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function fail(status, errors) {
  return { status, body: { ok: false, errors: errors.map((e) => (typeof e === 'string' ? { message: e } : e)) } };
}

function decodeLogo(logo, spec) {
  if (!logo || typeof logo.data !== 'string') return { error: 'Your hamper uses a logo, but no logo file was attached. Upload it in the Personalise step.' };
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(logo.data);
  if (!m) return { error: 'The logo file could not be read. Upload it again as PNG, JPG or WebP.' };
  const type = m[1];
  if (!spec.types.includes(type) || !MAGIC[type]) return { error: 'The logo must be a PNG, JPG or WebP image.' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > spec.maxBytes) return { error: 'The logo must be smaller than ' + Math.round(spec.maxBytes / 1048576) + ' MB.' };
  if (!MAGIC[type](buf)) return { error: 'The logo file does not match its type. Export it again as PNG, JPG or WebP.' };
  return { type, buf };
}

function createOrderHandler({ catalogue: CAT, pricing: P, store, mailer, uploads, options = {}, now = () => new Date() }) {
  const sendAck = options.sendCustomerAck !== false;

  return async function handle(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, ['The request was not understood.']);
    if (!body.config || typeof body.config !== 'object') return fail(400, ['The hamper configuration is missing.']);

    // 1. Customer details
    const customer = P.cleanCustomer(body.customer);
    const custErrors = P.validateCustomer(customer, CAT, now());
    if (Object.keys(custErrors).length) {
      return fail(422, Object.keys(custErrors).map((field) => ({ field, message: custErrors[field] })));
    }

    // 2. Configuration: normalise with the server's catalogue, then validate
    let config;
    try { config = JSON.parse(JSON.stringify(body.config)); } catch (e) { return fail(400, ['The hamper configuration is not valid.']); }
    const norm = P.normalize(config, CAT);
    config = norm.config;
    const v = P.validate(config, CAT);
    if (v.errors.length) return fail(422, v.errors.map((e) => ({ step: e.step, message: e.message })));

    // 3. Logo, when the configuration uses one
    const usesLogo = config.hamper.useLogo || config.items.some((it) => it.personal.on && it.personal.logo);
    let logoFile = null;
    if (usesLogo) {
      const d = decodeLogo(body.logo, CAT.hamperPersonal.logo);
      if (d.error) return fail(422, [{ step: 'personalise', message: d.error }]);
      logoFile = d;
    }

    // 4. Trusted price
    const pricing = P.computePrice(config, CAT);
    const clientTotal = body.client && typeof body.client.grandTotal === 'number' ? body.client.grandTotal : null;

    // 5. Reference (unique in the store)
    let reference = P.makeReference(now());
    for (let i = 0; i < 5 && (await store.exists(reference)); i++) reference = P.makeReference(now());

    let logo = null;
    if (logoFile) {
      const fileName = reference + '-logo-' + crypto.randomBytes(4).toString('hex') + '.' + EXT[logoFile.type];
      try {
        await uploads.save(fileName, logoFile.buf);
      } catch (e) {
        return fail(500, ['We could not store your logo. Please try again in a moment.']);
      }
      const original = body.logo && typeof body.logo.name === 'string' ? body.logo.name.replace(/[^\w .()-]/g, '_').slice(0, 120) : '';
      logo = { file: fileName, type: logoFile.type, size: logoFile.buf.length, originalName: original };
    }

    const order = {
      reference,
      createdAt: now().toISOString(),
      status: 'quotation_requested',
      customer,
      config,
      summary: P.describe(config, CAT),
      pricing,
      warnings: v.warnings.map((w) => w.message),
      adjustments: norm.notices,
      logo,
      catalogueVersion: CAT.meta.version,
      clientCatalogueVersion: typeof body.catalogueVersion === 'string' ? body.catalogueVersion.slice(0, 40) : null,
      clientTotal,
      priceMismatch: clientTotal != null && clientTotal !== pricing.grandTotal,
      email: {
        business: { status: mailer ? 'pending' : 'not_configured', attempts: 0 },
        customer: { status: mailer && sendAck ? 'pending' : 'not_configured', attempts: 0 }
      }
    };

    // 6. Save before anything else is promised
    try {
      await store.save(order);
    } catch (e) {
      return fail(500, ['We could not save your request just now. Your hamper is still on the page; please try again.']);
    }

    // 7. Notifications. A failure is recorded; the order is kept.
    if (mailer) {
      await deliver(order, 'business', () => mailer.send(buildBusinessEmail(order, CAT, P, logoFile ? logoFile.buf : null)));
      if (sendAck) await deliver(order, 'customer', () => mailer.send(buildCustomerEmail(order, CAT, P)));
      try { await store.update(order); } catch (e) { /* statuses stay pending; the retry script picks them up */ }
    }

    return {
      status: 201,
      body: {
        ok: true,
        reference,
        status: order.status,
        emailStatus: order.email.business.status,
        customerEmailStatus: order.email.customer.status,
        pricing: {
          perHamper: pricing.perHamper, netPerHamper: pricing.netPerHamper, hampers: pricing.hampers,
          subtotal: pricing.subtotal, tax: pricing.tax, delivery: pricing.delivery, grandTotal: pricing.grandTotal
        },
        adjustments: norm.notices,
        priceMismatch: order.priceMismatch
      }
    };
  };
}

async function deliver(order, who, sendFn) {
  const rec = order.email[who];
  rec.attempts = (rec.attempts || 0) + 1;
  rec.lastAttemptAt = new Date().toISOString();
  try {
    const res = await sendFn();
    rec.status = 'sent';
    rec.id = res && res.id ? String(res.id) : undefined;
    delete rec.error;
  } catch (e) {
    rec.status = 'failed';
    rec.error = String((e && e.message) || e).slice(0, 300);
  }
}

module.exports = { createOrderHandler, deliver, decodeLogo };
