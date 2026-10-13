'use strict';
/*
 * Homepage enquiry form ("Get My Free Mockup").
 *   const handle = createEnquiryHandler({ store, mailer, options });
 *   const { status, body } = await handle(json);
 * Saves first, then emails KORE (and the customer, when enabled). An email
 * failure is recorded on the enquiry; it is never reported as sent.
 */
const { deliver } = require('./order-handler');

const OCCASIONS = ['Onboarding', 'Festive or Diwali', 'Client gift', 'Anniversary', 'Wedding', 'Other'];
const QUANTITIES = ['Under 25', '25 to 99', '100 to 499', '500+'];

function str(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : ''; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function reference(now) {
  const d = new Date(now), a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return 'ENQ-' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + s;
}

function businessEmail(e) {
  const rows = [['Reference', e.reference], ['Received', e.createdAt], ['Name', e.name], ['Email', e.email], ['Company', e.company], ['Occasion', e.occasion], ['Recipients', e.quantity]].filter((r) => r[1]);
  return {
    audience: 'business',
    subject: 'New enquiry ' + e.reference + ' · ' + (e.company || e.name) + ' · ' + e.occasion + ', ' + e.quantity,
    text: 'New homepage enquiry\n\n' + rows.map((r) => r[0] + ': ' + r[1]).join('\n'),
    html: '<div style="font:14px/1.5 Arial,sans-serif"><h2 style="font:600 20px Georgia,serif">New enquiry ' + esc(e.reference) + '</h2><table cellpadding="6">' + rows.map((r) => '<tr><td style="color:#6B6055">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table></div>',
    replyTo: e.email
  };
}
function customerEmail(e, business) {
  const text = 'Hello ' + e.name + ',\n\nThank you for getting in touch about ' + e.occasion.toLowerCase() + ' gifting for ' + e.quantity.toLowerCase() + ' recipients. Your reference is ' + e.reference + '.\n\nWe reply within 24 hours with a custom proposal and a free mockup.\n\n' + business;
  return { audience: 'customer', to: e.email, subject: 'We have your enquiry · ' + e.reference, text, html: '<div style="font:15px/1.55 Arial,sans-serif">' + esc(text).replace(/\n/g, '<br>') + '</div>' };
}

function createEnquiryHandler({ store, mailer, options = {}, now = () => new Date() }) {
  const sendAck = options.sendCustomerAck !== false;
  const businessName = options.businessName || 'KORE Gifting Studio';
  return async function handle(body) {
    if (!body || typeof body !== 'object') return { status: 400, body: { ok: false, errors: [{ message: 'The request was not understood.' }] } };
    const e = {
      occasion: OCCASIONS.includes(body.occasion) ? body.occasion : 'Other',
      quantity: QUANTITIES.includes(body.quantity) ? body.quantity : 'Under 25',
      name: str(body.name, 80), email: str(body.email, 120), company: str(body.company, 100)
    };
    const errors = [];
    if (e.name.length < 2) errors.push({ field: 'name', message: 'Enter your name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.email)) errors.push({ field: 'email', message: 'Enter an email address like name@company.com.' });
    if (errors.length) return { status: 422, body: { ok: false, errors } };
    e.reference = reference(now());
    for (let i = 0; i < 5 && (await store.exists(e.reference)); i++) e.reference = reference(now());
    e.createdAt = now().toISOString();
    e.status = 'new';
    e.notifications = { business: { status: mailer ? 'pending' : 'not_configured', attempts: 0 }, customer: { status: mailer && sendAck ? 'pending' : 'not_configured', attempts: 0 } };
    try { await store.save(e); } catch (err) { return { status: 500, body: { ok: false, errors: [{ message: 'We could not save your enquiry just now. Please try again or call us.' }] } }; }
    if (mailer) {
      const wrapper = { email: e.notifications };
      await deliver(wrapper, 'business', () => mailer.send(businessEmail(e)));
      if (sendAck) await deliver(wrapper, 'customer', () => mailer.send(customerEmail(e, businessName)));
      try { await store.update(e); } catch (err) { /* retry script picks it up */ }
    }
    return { status: 201, body: { ok: true, reference: e.reference, emailStatus: e.notifications.business.status, customerEmailStatus: e.notifications.customer.status } };
  };
}

module.exports = { createEnquiryHandler, OCCASIONS, QUANTITIES, businessEmail, customerEmail };
