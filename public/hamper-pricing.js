/*
 * KORE hamper pricing and rules engine.
 *
 * One source of truth for: default configuration, compatibility clean-up
 * (normalize), validation, capacity, and price calculation. The browser uses
 * it for the live total; the order server runs the SAME functions on the
 * submitted configuration and ignores any total sent by the browser.
 *
 * No DOM access here, so it runs unchanged in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KorePricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE_ORDER = ['s', 'm', 'l', 'xl'];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findBox(cat, id) { return byId(cat.boxes, id); }
  function findFilling(cat, id) { return byId(cat.fillings, id); }
  function findProduct(cat, id) { return byId(cat.products, id); }
  function findFinishing(cat, id) { return byId(cat.finishing, id); }
  function colourLabel(cat, id) { return id && cat.colours[id] ? cat.colours[id].label : ''; }

  function str(v, max) {
    if (typeof v !== 'string') return '';
    v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return max != null ? v.slice(0, max) : v;
  }

  function uid() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* Size data for a given box, honouring box-specific dims/capacity. */
  function sizeInfo(cat, box, size) {
    var base = cat.sizes[size];
    if (!base) return null;
    return {
      id: size,
      label: base.label,
      dims: (box && box.dims && box.dims[size]) || base.dims,
      capacity: (box && box.capacity && box.capacity[size]) || base.capacity,
      fillFactor: base.fillFactor
    };
  }

  function boxSizes(box) {
    return SIZE_ORDER.filter(function (s) { return box && box.sizes[s] != null; });
  }

  function emptyHamper() {
    return { name: '', company: '', event: '', greeting: '', tagline: '', message: '', font: 'serif', textColour: 'gold', placement: 'lid', useLogo: false, ribbonText: '' };
  }

  function makeItem(cat, productId, extra) {
    var p = findProduct(cat, productId);
    var item = {
      uid: uid(),
      productId: productId,
      qty: 1,
      colour: p && p.colours.length ? p.colours[0] : null,
      variant: p && p.variants ? p.variants[0] : null,
      personal: { on: false, method: p && p.personal ? p.personal.methods[0] : null, text: '', logo: false, font: 'sans', textColour: 'gold', placement: p && p.personal ? p.personal.placements[0] : null }
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) item[k] = extra[k];
    return item;
  }

  function defaultConfig(cat, opts) {
    opts = opts || {};
    var box = findBox(cat, cat.defaults.boxId) || cat.boxes[0];
    var filling = findFilling(cat, cat.defaults.fillingId) || cat.fillings[0];
    var cfg = {
      v: 1,
      boxId: box.id,
      size: box.sizes[cat.defaults.size] != null ? cat.defaults.size : boxSizes(box)[0],
      colours: { exterior: box.colours.exterior[0], interior: box.colours.interior[0], lid: box.colours.lid[0] || null, ribbon: null },
      lining: box.linings[0].id,
      fillingId: filling.id,
      fillingColour: filling.colours[0] || null,
      items: [],
      hamper: emptyHamper(),
      finishing: [],
      hampers: 1,
      sample: false
    };
    if (opts.sample) {
      cfg.sample = true;
      cfg.colours.exterior = 'navy'; cfg.colours.lid = 'navy'; cfg.colours.interior = 'ivory';
      cfg.fillingColour = 'ivory';
      cfg.items = [
        makeItem(cat, 'notebook', { colour: 'navy' }),
        makeItem(cat, 'steel-bottle', { colour: 'navy' }),
        makeItem(cat, 'pen', { colour: 'gold' }),
        makeItem(cat, 'chocolates', { colour: 'gold' })
      ];
      cfg.finishing = ['ribbon-satin', 'bow'];
      cfg.colours.ribbon = 'gold';
      cfg.hamper.company = 'Your Company';
    }
    return cfg;
  }

  /*
   * Bring a configuration back to a valid shape after any change.
   * Mutates and returns { config, notices }. Notices explain anything that
   * was changed because it no longer fits the chosen box.
   */
  function normalize(cfg, cat) {
    var notices = [];
    if (!cfg || typeof cfg !== 'object') cfg = defaultConfig(cat);
    cfg.v = 1;

    var box = findBox(cat, cfg.boxId);
    if (!box || box.available === false) {
      if (cfg.boxId) notices.push('The selected box is no longer available, so we switched to the ' + cat.boxes[0].name + '.');
      box = findBox(cat, cat.defaults.boxId) || cat.boxes[0];
      cfg.boxId = box.id;
    }

    var sizes = boxSizes(box);
    if (sizes.indexOf(cfg.size) < 0) {
      var prev = cfg.size;
      var want = SIZE_ORDER.indexOf(prev);
      var best = sizes[0];
      sizes.forEach(function (s) { if (Math.abs(SIZE_ORDER.indexOf(s) - want) < Math.abs(SIZE_ORDER.indexOf(best) - want)) best = s; });
      cfg.size = best;
      if (prev && cat.sizes[prev]) notices.push(box.name + ' does not come in ' + cat.sizes[prev].label + ', so the size is now ' + cat.sizes[best].label + '.');
    }

    cfg.colours = cfg.colours || {};
    ['exterior', 'interior', 'lid'].forEach(function (part) {
      var allowed = box.colours[part] || [];
      var cur = cfg.colours[part];
      if (!allowed.length) { cfg.colours[part] = null; return; }
      if (allowed.indexOf(cur) < 0) {
        cfg.colours[part] = allowed[0];
        if (cur) notices.push(colourLabel(cat, cur) + ' is not available for the ' + part + ' of the ' + box.name + '. It is now ' + colourLabel(cat, allowed[0]) + '.');
      }
    });

    if (!byId(box.linings, cfg.lining)) {
      var prevL = cfg.lining;
      cfg.lining = box.linings[0].id;
      if (prevL && prevL !== cfg.lining) notices.push('Lining changed to ' + box.linings[0].label + ' to suit the ' + box.name + '.');
    }

    var filling = findFilling(cat, cfg.fillingId);
    if (!filling) { filling = findFilling(cat, cat.defaults.fillingId) || cat.fillings[0]; cfg.fillingId = filling.id; }
    if (!filling.colours.length) cfg.fillingColour = null;
    else if (filling.colours.indexOf(cfg.fillingColour) < 0) {
      if (cfg.fillingColour) notices.push(filling.name + ' does not come in ' + colourLabel(cat, cfg.fillingColour) + '. It is now ' + colourLabel(cat, filling.colours[0]) + '.');
      cfg.fillingColour = filling.colours[0];
    }

    // Products
    var items = Array.isArray(cfg.items) ? cfg.items : [];
    cfg.items = [];
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var p = findProduct(cat, it.productId);
      if (!p || p.available === false) { notices.push('A product that is no longer available was removed.'); return; }
      var qty = Math.floor(Number(it.qty));
      if (!isFinite(qty) || qty < 1) qty = 1;
      if (qty > (p.maxPerHamper || 99)) qty = p.maxPerHamper || 99;
      var colour = p.colours.length ? (p.colours.indexOf(it.colour) >= 0 ? it.colour : p.colours[0]) : null;
      var variant = p.variants ? (p.variants.indexOf(it.variant) >= 0 ? it.variant : p.variants[0]) : null;
      var pers = it.personal && typeof it.personal === 'object' ? it.personal : {};
      var personal = { on: false, method: null, text: '', logo: false, font: 'sans', textColour: 'gold', placement: null };
      if (p.personal) {
        personal.on = !!pers.on;
        personal.method = p.personal.methods.indexOf(pers.method) >= 0 ? pers.method : p.personal.methods[0];
        personal.text = p.personal.fields.indexOf('text') >= 0 ? str(pers.text, p.personal.maxChars) : '';
        personal.logo = p.personal.fields.indexOf('logo') >= 0 ? !!pers.logo : false;
        personal.font = byId(cat.fonts, pers.font) ? pers.font : 'sans';
        personal.textColour = cat.textColours.indexOf(pers.textColour) >= 0 ? pers.textColour : cat.textColours[0];
        personal.placement = p.personal.placements.indexOf(pers.placement) >= 0 ? pers.placement : p.personal.placements[0];
      }
      cfg.items.push({ uid: typeof it.uid === 'string' && it.uid ? str(it.uid, 40) : uid(), productId: p.id, qty: qty, colour: colour, variant: variant, personal: personal });
    });

    // Finishing touches
    var fin = Array.isArray(cfg.finishing) ? cfg.finishing : [];
    var seen = {}, groups = {}, kept = [];
    fin.forEach(function (id) {
      var f = findFinishing(cat, id);
      if (!f || seen[id]) return;
      seen[id] = true;
      if (f.shapes && f.shapes.indexOf(box.shape) < 0) { notices.push(f.name + ' was removed: it does not suit the ' + box.name + '.'); return; }
      if (f.boxes && f.boxes.indexOf(box.id) < 0) { notices.push(f.name + ' was removed: it is only available on rigid boxes.'); return; }
      if (f.group) {
        if (groups[f.group]) kept = kept.filter(function (k) { return k !== groups[f.group]; });
        groups[f.group] = id;
      }
      kept.push(id);
    });
    kept = kept.filter(function (id) {
      var f = findFinishing(cat, id);
      if (f.requires && !groups[f.requires]) { notices.push(f.name + ' was removed because it needs a ribbon.'); return false; }
      return true;
    });
    cfg.finishing = kept;

    var ribbon = groups.ribbon ? findFinishing(cat, groups.ribbon) : null;
    if (ribbon) {
      if (ribbon.colours.indexOf(cfg.colours.ribbon) < 0) {
        if (cfg.colours.ribbon) notices.push(ribbon.name + ' does not come in ' + colourLabel(cat, cfg.colours.ribbon) + '. It is now ' + colourLabel(cat, ribbon.colours[0]) + '.');
        cfg.colours.ribbon = ribbon.colours[0];
      }
    } else cfg.colours.ribbon = null;

    // Hamper personalisation
    var h = cfg.hamper && typeof cfg.hamper === 'object' ? cfg.hamper : {};
    var L = cat.hamperPersonal.limits;
    var nh = emptyHamper();
    ['name', 'company', 'event', 'greeting', 'tagline', 'message', 'ribbonText'].forEach(function (k) { nh[k] = str(h[k], L[k]); });
    nh.font = byId(cat.fonts, h.font) ? h.font : 'serif';
    nh.textColour = cat.textColours.indexOf(h.textColour) >= 0 ? h.textColour : 'gold';
    nh.placement = byId(cat.hamperPersonal.placements, h.placement) ? h.placement : 'lid';
    if (nh.placement === 'lid' && box.lid === 'none') {
      nh.placement = 'front';
      if (h.placement === 'lid') notices.push('The ' + box.name + ' has no lid, so your text moves to the front.');
    }
    nh.useLogo = !!h.useLogo;
    if (!ribbon) nh.ribbonText = '';
    cfg.hamper = nh;

    var n = Math.floor(Number(cfg.hampers));
    if (!isFinite(n) || n < 1) n = 1;
    cfg.hampers = n;
    cfg.sample = !!cfg.sample;

    return { config: cfg, notices: notices };
  }

  function capacity(cfg, cat) {
    var box = findBox(cat, cfg.boxId);
    var si = sizeInfo(cat, box, cfg.size);
    var used = 0;
    cfg.items.forEach(function (it) {
      var p = findProduct(cat, it.productId);
      if (p) used += (p.volume || 1) * it.qty;
    });
    used = Math.round(used * 100) / 100;
    return { used: used, capacity: si ? si.capacity : 0, over: si ? used > si.capacity : false };
  }

  function hasText(h) {
    return !!(h.name || h.company || h.event || h.greeting || h.tagline);
  }

  /* Returns { errors: [], warnings: [] }; each entry { step, message }. */
  function validate(cfg, cat) {
    var errors = [], warnings = [];
    var box = findBox(cat, cfg.boxId);
    var cap = capacity(cfg, cat);
    var sizeIdx = SIZE_ORDER.indexOf(cfg.size);
    var P = cat.pricing;

    if (!cfg.items.length) errors.push({ step: 'products', message: 'Add at least one product to your hamper.' });
    if (cap.over) errors.push({ step: 'products', message: 'Your products need ' + cap.used + ' of ' + cap.capacity + ' spaces in this box. Choose a larger size or remove something.' });

    cfg.items.forEach(function (it) {
      var p = findProduct(cat, it.productId);
      if (!p) return;
      if (p.minSize && sizeIdx < SIZE_ORDER.indexOf(p.minSize)) errors.push({ step: 'box', message: p.name + ' needs a ' + cat.sizes[p.minSize].label + ' box or larger.' });
      if (p.fragile && box.softSided) warnings.push({ step: 'box', message: p.name + ' is fragile. A soft-sided ' + box.name + ' gives it little protection.' });
      if (it.personal.on && !it.personal.text && !it.personal.logo) errors.push({ step: 'personalise', message: 'Add text or a logo for the ' + p.name + ', or switch its personalisation off.' });
      if (p.stock != null && it.qty * cfg.hampers > p.stock) errors.push({ step: 'review', message: 'Only ' + p.stock + ' of ' + p.name + ' are in stock; this order needs ' + (it.qty * cfg.hampers) + '.' });
    });

    var h = cfg.hamper;
    var plc = byId(cat.hamperPersonal.placements, h.placement);
    if ((hasText(h) || h.useLogo) && plc && plc.requiresFinishing && cfg.finishing.indexOf(plc.requiresFinishing) < 0) {
      var f = findFinishing(cat, plc.requiresFinishing);
      errors.push({ step: 'personalise', message: 'Your text is placed on the ' + plc.label.toLowerCase() + '. Add the ' + f.name.toLowerCase() + ' in Finishing touches, or choose another placement.' });
    }
    if (h.message && cfg.finishing.indexOf('card-message') < 0) warnings.push({ step: 'finishing', message: 'Your personal message is printed only on the Custom message card. Add it in Finishing touches.' });

    if (cfg.hampers < P.minHampers) errors.push({ step: 'review', message: 'Order at least ' + P.minHampers + ' hamper.' });
    if (cfg.hampers > P.maxHampersPerOrder) errors.push({ step: 'review', message: 'Orders above ' + P.maxHampersPerOrder + ' hampers need a call with our team. Please reduce the quantity or enquire directly.' });

    return { errors: errors, warnings: warnings };
  }

  function round(n) { return Math.round(n); }

  /*
   * Price breakdown for one configuration.
   * Formula: per hamper = box + filling + lining upgrade + products
   *          + personalisation + finishing; minus bulk discount (if configured);
   *          x number of hampers; + tax and delivery only when configured.
   */
  function computePrice(cfg, cat) {
    var lines = [];
    var box = findBox(cat, cfg.boxId);
    var si = sizeInfo(cat, box, cfg.size);
    var filling = findFilling(cat, cfg.fillingId);

    lines.push({ group: 'box', label: box.name + ' · ' + si.label, unit: box.sizes[cfg.size], qty: 1, amount: box.sizes[cfg.size] });

    var lining = byId(box.linings, cfg.lining);
    if (lining && lining.price) lines.push({ group: 'upgrade', label: lining.label, unit: lining.price, qty: 1, amount: lining.price });

    if (filling && filling.price) {
      var fp = round(filling.price * si.fillFactor);
      lines.push({ group: 'filling', label: filling.name + ' (' + si.label.toLowerCase() + ' box)', unit: fp, qty: 1, amount: fp });
    }

    var productTotals = [];
    cfg.items.forEach(function (it) {
      var p = findProduct(cat, it.productId);
      if (!p) return;
      var unit = p.price + ((p.variantPrices && it.variant && p.variantPrices[it.variant]) || 0);
      var label = p.name + (it.variant ? ' (' + it.variant + ')' : '') + (it.colour ? ' · ' + colourLabel(cat, it.colour) : '');
      lines.push({ group: 'products', label: label, unit: unit, qty: it.qty, amount: unit * it.qty, itemUid: it.uid });
      if (it.personal.on && it.personal.method && (it.personal.text || it.personal.logo)) {
        var m = cat.methods[it.personal.method];
        lines.push({ group: 'personal', label: m.label + ': ' + p.name, unit: m.charge, qty: it.qty, amount: m.charge * it.qty, itemUid: it.uid });
      }
      productTotals.push({ productId: p.id, name: p.name, variant: it.variant, colour: it.colour, perHamper: it.qty, total: it.qty * cfg.hampers });
    });

    var HP = cat.hamperPersonal, h = cfg.hamper;
    if (hasText(h)) lines.push({ group: 'personal', label: 'Box text printing', unit: HP.printCharge, qty: 1, amount: HP.printCharge });
    if (h.useLogo) lines.push({ group: 'personal', label: 'Logo printed on box', unit: HP.logoCharge, qty: 1, amount: HP.logoCharge });
    if (h.ribbonText && cfg.colours.ribbon) lines.push({ group: 'personal', label: 'Printed ribbon text', unit: HP.ribbonPrintCharge, qty: 1, amount: HP.ribbonPrintCharge });

    cfg.finishing.forEach(function (id) {
      var f = findFinishing(cat, id);
      if (!f) return;
      var label = f.name + (f.group === 'ribbon' && cfg.colours.ribbon ? ' · ' + colourLabel(cat, cfg.colours.ribbon) : '');
      lines.push({ group: 'finishing', label: label, unit: f.price, qty: 1, amount: f.price });
    });

    var perHamper = lines.reduce(function (s, l) { return s + l.amount; }, 0);
    var hampers = cfg.hampers;

    var P = cat.pricing, tier = null;
    (P.bulkTiers || []).forEach(function (t) { if (hampers >= t.minHampers && (!tier || t.minHampers > tier.minHampers)) tier = t; });
    var discountPerHamper = tier ? round(perHamper * tier.discountPct / 100) : 0;
    var netPerHamper = perHamper - discountPerHamper;
    var subtotal = netPerHamper * hampers;
    var tax = P.taxRate != null ? round(subtotal * P.taxRate) : null;
    var delivery = P.deliveryCharge != null ? P.deliveryCharge : null;
    var grandTotal = subtotal + (tax || 0) + (delivery || 0);

    function groupSum(g) { return lines.filter(function (l) { return l.group === g; }).reduce(function (s, l) { return s + l.amount; }, 0); }

    return {
      currency: cat.meta.currency,
      demo: !!cat.meta.pricesAreDemo,
      catalogueVersion: cat.meta.version,
      lines: lines,
      groups: { box: groupSum('box'), filling: groupSum('filling'), upgrade: groupSum('upgrade'), products: groupSum('products'), personal: groupSum('personal'), finishing: groupSum('finishing') },
      perHamper: perHamper,
      bulkTier: tier,
      discountPerHamper: discountPerHamper,
      netPerHamper: netPerHamper,
      hampers: hampers,
      subtotal: subtotal,
      tax: tax,
      taxLabel: P.taxLabel,
      taxRate: P.taxRate,
      delivery: delivery,
      deliveryNote: P.deliveryNote,
      grandTotal: grandTotal,
      productTotals: productTotals
    };
  }

  function formatINR(n, cat) {
    var locale = (cat && cat.meta.locale) || 'en-IN';
    try { return '₹' + Math.round(n).toLocaleString(locale); } catch (e) { return '₹' + Math.round(n); }
  }

  /* A readable, plain-text description of a configuration (emails, review). */
  function describe(cfg, cat) {
    var box = findBox(cat, cfg.boxId), si = sizeInfo(cat, box, cfg.size), filling = findFilling(cat, cfg.fillingId);
    var lining = byId(box.linings, cfg.lining);
    var out = {
      box: box.name + ', ' + si.label + ' (' + si.dims.join(' × ') + ' cm)',
      material: box.material,
      colours: 'Exterior ' + colourLabel(cat, cfg.colours.exterior) + (cfg.colours.lid ? ', lid ' + colourLabel(cat, cfg.colours.lid) : '') + ', interior ' + colourLabel(cat, cfg.colours.interior),
      lining: lining ? lining.label : '',
      filling: filling.name + (cfg.fillingColour ? ', ' + colourLabel(cat, cfg.fillingColour) : ''),
      items: cfg.items.map(function (it) {
        var p = findProduct(cat, it.productId);
        var s = it.qty + ' × ' + p.name + (it.variant ? ' (' + it.variant + ')' : '') + (it.colour ? ', ' + colourLabel(cat, it.colour) : '');
        if (it.personal.on) s += ' | ' + cat.methods[it.personal.method].label + (it.personal.text ? ': "' + it.personal.text + '"' : '') + (it.personal.logo ? ' + logo' : '') + ', ' + it.personal.placement + ', ' + byId(cat.fonts, it.personal.font).label + ', ' + colourLabel(cat, it.personal.textColour);
        return s;
      }),
      hamper: (function () {
        var h = cfg.hamper, parts = [];
        if (h.name) parts.push('Name: ' + h.name);
        if (h.company) parts.push('Company/institution: ' + h.company);
        if (h.event) parts.push('Event: ' + h.event);
        if (h.greeting) parts.push('Greeting: ' + h.greeting);
        if (h.tagline) parts.push('Tagline: ' + h.tagline);
        if (h.message) parts.push('Message card: ' + h.message);
        if (h.ribbonText) parts.push('Ribbon text: ' + h.ribbonText);
        if (h.useLogo) parts.push('Logo on box: yes');
        if (parts.length) {
          var pl = byId(cat.hamperPersonal.placements, h.placement);
          parts.push('Placement: ' + (pl ? pl.label : h.placement) + ', font: ' + byId(cat.fonts, h.font).label + ', colour: ' + colourLabel(cat, h.textColour));
        }
        return parts;
      })(),
      finishing: cfg.finishing.map(function (id) {
        var f = findFinishing(cat, id);
        return f.name + (f.group === 'ribbon' && cfg.colours.ribbon ? ' (' + colourLabel(cat, cfg.colours.ribbon) + ')' : '');
      })
    };
    return out;
  }

  /* ---------- customer details (shared by page and server) ---------- */
  var CUSTOMER_LIMITS = { name: 80, email: 120, phone: 20, company: 100, event: 100, location: 600, billing: 600, gstin: 15, budget: 40, contactMethod: 20, instructions: 2000, deliveryDate: 10 };

  function cleanCustomer(c) {
    c = c && typeof c === 'object' ? c : {};
    var out = {};
    Object.keys(CUSTOMER_LIMITS).forEach(function (k) { out[k] = str(c[k], CUSTOMER_LIMITS[k]).trim(); });
    out.gstin = out.gstin.toUpperCase();
    out.acceptQuote = !!c.acceptQuote;
    return out;
  }

  function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function earliestDelivery(cat, now) {
    var d = new Date(now || Date.now());
    d.setDate(d.getDate() + (cat.pricing.leadTimeDays || 0));
    return isoDate(d);
  }

  /* Returns { field: message } for every problem; empty object when valid. */
  function validateCustomer(c, cat, now) {
    var e = {};
    if (c.name.length < 2) e.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) e.email = 'Enter an email address like name@company.com.';
    var digits = c.phone.replace(/[\s\-().]/g, '');
    if (!/^\+?\d{10,15}$/.test(digits)) e.phone = 'Enter a phone number with at least 10 digits.';
    if (c.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(c.gstin)) e.gstin = 'A GSTIN has 15 characters, for example 27ABCDE1234F1Z5.';
    if (c.deliveryDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.deliveryDate)) e.deliveryDate = 'Choose a delivery date.';
      else if (c.deliveryDate < earliestDelivery(cat, now)) e.deliveryDate = 'The earliest delivery date we can offer is ' + earliestDelivery(cat, now) + '.';
    }
    if (!c.acceptQuote) e.acceptQuote = 'Please confirm you understand this is a quotation request.';
    return e;
  }

  function makeReference(now) {
    var d = new Date(now || Date.now());
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return 'KORE-' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + s;
  }

  return {
    cleanCustomer: cleanCustomer, validateCustomer: validateCustomer, earliestDelivery: earliestDelivery, makeReference: makeReference,
    SIZE_ORDER: SIZE_ORDER,
    findBox: findBox, findFilling: findFilling, findProduct: findProduct, findFinishing: findFinishing,
    colourLabel: colourLabel, sizeInfo: sizeInfo, boxSizes: boxSizes,
    defaultConfig: defaultConfig, makeItem: makeItem, normalize: normalize,
    capacity: capacity, validate: validate, computePrice: computePrice,
    formatINR: formatINR, describe: describe, byId: byId
  };
});
