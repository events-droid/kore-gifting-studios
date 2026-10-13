'use strict';
/* Email content for a submitted quotation request. */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(P, CAT, n) { return n == null ? 'Confirmed on quotation' : P.formatINR(n, CAT); }

function pricingRows(order, P, CAT) {
  const pr = order.pricing;
  const rows = pr.lines.map((l) => [l.label + (l.qty > 1 ? ' (' + l.qty + ' × ' + P.formatINR(l.unit, CAT) + ')' : ''), P.formatINR(l.amount, CAT)]);
  rows.push(['Price per hamper', P.formatINR(pr.perHamper, CAT)]);
  if (pr.discountPerHamper) rows.push(['Volume discount per hamper', '−' + P.formatINR(pr.discountPerHamper, CAT)]);
  rows.push(['Hampers', String(pr.hampers)]);
  rows.push(['Subtotal', P.formatINR(pr.subtotal, CAT)]);
  rows.push([pr.taxLabel, money(P, CAT, pr.tax)]);
  rows.push(['Delivery', money(P, CAT, pr.delivery)]);
  rows.push(['Estimated grand total', P.formatINR(pr.grandTotal, CAT)]);
  return rows;
}

function buildBusinessEmail(order, CAT, P, logoBuf) {
  const c = order.customer, s = order.summary, pr = order.pricing;
  const contact = [
    ['Reference', order.reference], ['Submitted', order.createdAt], ['Name', c.name], ['Email', c.email], ['Phone', c.phone],
    ['Preferred contact', c.contactMethod], ['Company / institution', c.company], ['Event', c.event],
    ['Required delivery date', c.deliveryDate], ['Delivery location', c.location], ['Billing', c.billing], ['GSTIN', c.gstin],
    ['Budget', c.budget], ['Special instructions', c.instructions]
  ].filter((r) => r[1]);
  const hamper = [
    ['Number of hampers', String(pr.hampers)], ['Box', s.box], ['Material', s.material], ['Colours', s.colours], ['Lining', s.lining], ['Filling', s.filling]
  ];
  const units = pr.productTotals.map((t) => t.name + (t.variant ? ' (' + t.variant + ')' : '') + (t.colour ? ', ' + P.colourLabel(CAT, t.colour) : '') + ': ' + t.perHamper + ' per hamper, ' + t.total + ' in total');
  const notes = [].concat(
    order.priceMismatch ? ['The customer’s page showed ' + P.formatINR(order.clientTotal, CAT) + '; the server price above is the one recorded.'] : [],
    CAT.meta.pricesAreDemo ? ['Prices come from the demo catalogue. Replace them before quoting.'] : [],
    order.warnings || [], order.adjustments || []
  );

  const text = [
    'New hamper quotation request ' + order.reference, '',
    ...contact.map((r) => r[0] + ': ' + r[1]), '',
    'HAMPER', ...hamper.map((r) => r[0] + ': ' + r[1]), '',
    'Products (per hamper):', ...s.items.map((x) => '  - ' + x), '',
    'Units for the whole order:', ...units.map((x) => '  - ' + x), '',
    'Hamper personalisation:', ...(s.hamper.length ? s.hamper.map((x) => '  - ' + x) : ['  - None']), '',
    'Finishing touches:', ...(s.finishing.length ? s.finishing.map((x) => '  - ' + x) : ['  - None']), '',
    'Logo: ' + (order.logo ? order.logo.file + ' (' + order.logo.type + ', ' + Math.round(order.logo.size / 1024) + ' KB), attached' : 'None'), '',
    'PRICING', ...pricingRows(order, P, CAT).map((r) => r[0] + ': ' + r[1]),
    ...(notes.length ? ['', 'Notes:', ...notes.map((n) => '  - ' + n)] : [])
  ].join('\n');

  const table = (rows) => '<table cellpadding="6" style="border-collapse:collapse;font:14px/1.45 Arial,sans-serif">' + rows.map((r) => '<tr><td style="color:#6B6055;vertical-align:top;border-bottom:1px solid #eee">' + esc(r[0]) + '</td><td style="border-bottom:1px solid #eee">' + esc(r[1]).replace(/\n/g, '<br>') + '</td></tr>').join('') + '</table>';
  const list = (items) => '<ul style="font:14px/1.5 Arial,sans-serif;margin:0 0 12px;padding-left:20px">' + (items.length ? items : ['None']).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  const html = '<div style="font:14px/1.5 Arial,sans-serif;color:#211D19;max-width:720px">' +
    '<h2 style="font:600 22px Georgia,serif;margin:0 0 4px">Quotation request ' + esc(order.reference) + '</h2>' +
    '<p style="margin:0 0 16px;color:#6B6055">' + esc(pr.hampers + ' hampers · estimated ' + P.formatINR(pr.grandTotal, CAT)) + '</p>' +
    '<h3>Customer</h3>' + table(contact) +
    '<h3>Hamper</h3>' + table(hamper) +
    '<h3>Products per hamper</h3>' + list(s.items) +
    '<h3>Units for the whole order</h3>' + list(units) +
    '<h3>Hamper personalisation</h3>' + list(s.hamper) +
    '<h3>Finishing touches</h3>' + list(s.finishing) +
    '<h3>Logo</h3><p>' + (order.logo ? esc(order.logo.file) + ' is attached.' : 'None') + '</p>' +
    '<h3>Pricing</h3>' + table(pricingRows(order, P, CAT)) +
    (notes.length ? '<h3>Notes</h3>' + list(notes) : '') + '</div>';

  const attachments = order.logo && logoBuf ? [{ filename: order.logo.file, content: logoBuf.toString('base64') }] : [];
  return { audience: 'business', subject: 'Quotation request ' + order.reference + ' · ' + (c.company || c.name) + ' · ' + pr.hampers + ' hampers', text, html, replyTo: c.email, attachments };
}

function buildCustomerEmail(order, CAT, P) {
  const c = order.customer, pr = order.pricing, s = order.summary;
  const text = [
    'Hello ' + c.name + ',', '',
    'Thank you for your hamper quotation request. Your reference is ' + order.reference + '.', '',
    'Summary: ' + pr.hampers + ' × ' + s.box, ...s.items.map((x) => '  - ' + x),
    'Estimated total: ' + P.formatINR(pr.grandTotal, CAT) + (pr.tax == null ? ' (excluding ' + pr.taxLabel + ')' : '') + (pr.delivery == null ? ', delivery quoted separately' : ''), '',
    'What happens next:', '1. We review your hamper and check stock.', '2. We send a quotation with ' + pr.taxLabel + ' and delivery, plus a digital mockup.', '3. You approve, and we start production.', '',
    'No payment has been taken. Reply to this email if anything needs to change.', '', CAT.meta.business
  ].join('\n');
  const html = '<div style="font:15px/1.55 Arial,sans-serif;color:#211D19;max-width:600px">' +
    '<p>Hello ' + esc(c.name) + ',</p><p>Thank you for your hamper quotation request. Your reference is <strong>' + esc(order.reference) + '</strong>.</p>' +
    '<p><strong>' + esc(pr.hampers + ' × ' + s.box) + '</strong></p><ul>' + s.items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
    '<p>Estimated total: <strong>' + esc(P.formatINR(pr.grandTotal, CAT)) + '</strong>' + esc((pr.tax == null ? ' (excluding ' + pr.taxLabel + ')' : '') + (pr.delivery == null ? ', delivery quoted separately' : '')) + '</p>' +
    '<p><strong>What happens next</strong></p><ol><li>We review your hamper and check stock.</li><li>We send a quotation with ' + esc(pr.taxLabel) + ' and delivery, plus a digital mockup.</li><li>You approve, and we start production.</li></ol>' +
    '<p>No payment has been taken. Reply to this email if anything needs to change.</p><p>' + esc(CAT.meta.business) + '</p></div>';
  return { audience: 'customer', to: c.email, subject: 'Your hamper quotation request ' + order.reference, text, html };
}

module.exports = { buildBusinessEmail, buildCustomerEmail };
