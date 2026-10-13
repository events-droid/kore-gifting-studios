'use strict';
/*
 * Transactional email through Resend's HTTP API (https://resend.com).
 * Configure with environment variables; nothing secret lives in the browser.
 *
 *   RESEND_API_KEY   API key from your Resend account
 *   FROM_EMAIL       a sender on a domain you verified in Resend, e.g. "KORE <orders@yourdomain.in>"
 *   BUSINESS_EMAIL   where new orders are sent (comma-separate several)
 *
 * Returns null when not configured, and the order flow records
 * "not_configured" instead of pretending an email was sent.
 * To use another provider, return an object with the same send(message) method.
 */
function createMailer(env, fetchImpl) {
  const key = env.RESEND_API_KEY, from = env.FROM_EMAIL, business = env.BUSINESS_EMAIL;
  if (!key || !from || !business) return null;
  const doFetch = fetchImpl || globalThis.fetch;
  const businessList = business.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    async send(msg) {
      const to = msg.audience === 'business' ? businessList : [msg.to];
      const payload = { from, to, subject: msg.subject, text: msg.text, html: msg.html };
      if (msg.replyTo) payload.reply_to = msg.replyTo;
      if (msg.attachments && msg.attachments.length) payload.attachments = msg.attachments;
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Email provider returned ' + res.status + (data && data.message ? ': ' + data.message : ''));
      return { id: data.id };
    }
  };
}

module.exports = { createMailer };
