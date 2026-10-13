'use strict';
/*
 * Resend notification emails that failed or never ran.
 *   node server/retry-emails.js            retry every failed/pending email
 *   node server/retry-emails.js --list     only list orders whose emails are not sent
 * Run it by hand or on a schedule (cron) next to the server.
 * On Vercel: `vercel env pull .env.local`, load it into your shell, then run this
 * (see README, "Orders and emails").
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(ROOT, 'public'));
const CAT = require(path.join(PUBLIC_DIR, 'hamper-catalogue.js'));
const P = require(path.join(PUBLIC_DIR, 'hamper-pricing.js'));
const { createFileStore, createFileUploads } = require('./storage');
const { createMailer } = require('./mailer');
const { deliver } = require('./order-handler');
const { buildBusinessEmail, buildCustomerEmail } = require('./emails');

async function retryAll({ store, uploads, mailer, sendCustomerAck = true, listOnly = false, log = console.log }) {
  const orders = await store.list();
  const due = orders.filter((o) => ['failed', 'pending'].includes(o.email.business.status) || (sendCustomerAck && ['failed', 'pending'].includes(o.email.customer.status)));
  if (listOnly || !mailer) {
    due.forEach((o) => log(o.reference, 'business:', o.email.business.status, 'customer:', o.email.customer.status));
    if (!mailer && !listOnly) log('Email is not configured; nothing was sent.');
    return due.length;
  }
  for (const o of due) {
    if (['failed', 'pending'].includes(o.email.business.status)) {
      let logo = null;
      if (o.logo) logo = await (uploads.read ? uploads.read(o.logo.file) : fs.promises.readFile(uploads.path(o.logo.file))).catch(() => null);
      await deliver(o, 'business', () => mailer.send(buildBusinessEmail(o, CAT, P, logo)));
    }
    if (sendCustomerAck && ['failed', 'pending'].includes(o.email.customer.status)) {
      await deliver(o, 'customer', () => mailer.send(buildCustomerEmail(o, CAT, P)));
    }
    await store.update(o);
    log(o.reference, 'business:', o.email.business.status, 'customer:', o.email.customer.status);
  }
  return due.length;
}

if (require.main === module) {
  // With Redis settings in the environment (Vercel), read orders from there; otherwise from ORDERS_DIR.
  const { createRedis, createRedisStore, createRedisUploads } = require('../lib/redis');
  const redis = createRedis(process.env);
  const mailer = createMailer(process.env);
  const store = redis ? createRedisStore(redis, 'order') : createFileStore(path.resolve(process.env.ORDERS_DIR || path.join(ROOT, 'data', 'orders')));
  const uploads = redis ? createRedisUploads(redis, { canDeliverByEmail: !!mailer }) : createFileUploads(path.resolve(process.env.UPLOADS_DIR || path.join(ROOT, 'data', 'uploads')));
  retryAll({ store, uploads, mailer, sendCustomerAck: process.env.SEND_CUSTOMER_ACK !== 'false', listOnly: process.argv.includes('--list') })
    .then((n) => { console.log(n + ' order(s) checked.'); })
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { retryAll };
