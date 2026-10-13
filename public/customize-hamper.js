/*
 * KORE "Customize Your Hamper" page controller.
 *
 * One configuration object (state.cfg) drives everything: the controls,
 * the live preview, the price summary and the submitted order. Every change
 * goes through commit(), which runs the shared rules engine
 * (KorePricing.normalize) before anything is re-rendered.
 */
(function () {
  'use strict';

  var CAT = window.KoreCatalogue, P = window.KorePricing, V = window.KorePreview;
  var CFG = Object.assign({ orderEndpoint: null, orderEmail: 'koreexpression@gmail.com', storageKey: 'kore-hamper-v1', nav: [], brand: 'KORE', brandSub: 'Gifting Studios', logoSrc: 'img/kore-logo.png', previewRenderer: 'css' }, window.KORE_HAMPER_CONFIG || {});
  var esc = V.esc;
  var fmt = function (n) { return P.formatINR(n, CAT); };

  var STEPS = [
    { id: 'box', label: 'Box', title: 'Choose your box' },
    { id: 'filling', label: 'Filling', title: 'Choose the filling' },
    { id: 'products', label: 'Products', title: 'Add products' },
    { id: 'colours', label: 'Colours', title: 'Colours and materials' },
    { id: 'personalise', label: 'Personalise', title: 'Personalise and brand' },
    { id: 'finishing', label: 'Finishing', title: 'Finishing touches' },
    { id: 'review', label: 'Review', title: 'Review and quantity' },
    { id: 'order', label: 'Details', title: 'Your details' }
  ];
  function stepIndex(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i; return 0; }

  var state = {
    cfg: null,
    step: 0,
    visited: {},
    prodCat: 'all',
    prodQuery: '',
    logo: null,            // { name, type, size, preview (data URL, <=512px), original (data URL) }
    logoError: '',
    customer: { name: '', email: '', phone: '', company: '', event: '', deliveryDate: '', location: '', billing: '', gstin: '', budget: '', contactMethod: 'Email', instructions: '', acceptQuote: false },
    custErrors: {},
    showErrors: false,
    submitting: false,
    submitError: '',
    result: null,
    summaryOpen: false,
    previewHidden: false,
    inbox: { open: false, loading: false, orders: [], error: '' }
  };

  var preview = null;
  var els = {};
  var toastTimer = null;

  /* ---------- storage (per-browser convenience only) ---------- */
  function store(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function persist() {
    store(CFG.storageKey, { cfg: state.cfg, step: state.step, visited: state.visited, savedAt: Date.now() });
  }

  /* ---------- derived data ---------- */
  function box() { return P.findBox(CAT, state.cfg.boxId); }
  function size() { return P.sizeInfo(CAT, box(), state.cfg.size); }
  function price() { return P.computePrice(state.cfg, CAT); }
  function logoInUse() { return state.cfg.hamper.useLogo || state.cfg.items.some(function (it) { return it.personal.on && it.personal.logo; }); }
  function issues() {
    var v = P.validate(state.cfg, CAT);
    if (logoInUse() && !state.logo) v.errors.push({ step: 'personalise', message: 'Upload your logo, or switch off the logo options you selected.' });
    return v;
  }
  function stepIssues(stepId, list) { return list.filter(function (e) { return e.step === stepId; }); }

  /* ---------- changing the configuration ---------- */
  function commit(mutator, opts) {
    opts = opts || {};
    mutator(state.cfg);
    state.cfg.sample = false;
    state.result = null; // any change after sending starts a new request
    hideSampleNote();
    var res = P.normalize(state.cfg, CAT);
    state.cfg = res.config;
    if (res.notices.length) toast(res.notices.join(' '));
    persist();
    renderLive();
    if (opts.panel !== false) renderPanel();
  }

  /* ---------- rendering ---------- */
  function renderLive() {
    renderStage();
    renderSummary();
    renderSteps();
    renderMobileBar();
  }

  function renderAll() {
    renderHeader();
    renderLive();
    renderPanel();
  }

  function renderHeader() {
    var nav = (CFG.nav || []).map(function (n) {
      return '<a href="' + esc(n.href) + '"' + (n.current ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>';
    }).join('');
    els.header.innerHTML =
      '<a class="kh-brand" href="' + esc(CFG.homeHref || '#') + '"><img src="' + esc(CFG.logoSrc || 'img/kore-logo.png') + '" alt="' + esc(CFG.brand + ' ' + CFG.brandSub) + '" width="1200" height="222"></a>' +
      '<nav class="kh-nav" aria-label="Primary">' + nav + '</nav>' +
      '<div class="kh-head-actions"><button type="button" class="kh-btn kh-btn-ghost kh-inbox-btn" data-act="inbox" hidden>Order inbox</button>' +
      (CFG.enquireHref ? '<a class="kh-btn kh-btn-solid" href="' + esc(CFG.enquireHref) + '">Enquire Now</a>' : '') + '</div>';
  }

  function renderSteps() {
    var iss = issues();
    els.steps.innerHTML = STEPS.map(function (s, i) {
      var bad = stepIssues(s.id, iss.errors).length && (state.visited.review || state.showErrors);
      var cls = 'kh-step' + (i === state.step ? ' is-current' : '') + (state.visited[s.id] && i !== state.step ? ' is-visited' : '') + (bad ? ' has-error' : '');
      return '<li><button type="button" class="' + cls + '" data-act="goto" data-step="' + i + '"' + (i === state.step ? ' aria-current="step"' : '') + '>' +
        '<span class="kh-step-n">' + (i + 1) + '</span><span class="kh-step-l">' + esc(s.label) + '</span>' + (bad ? '<span class="kh-sr">, needs attention</span>' : '') + '</button></li>';
    }).join('');
    els.stepCount.textContent = 'Step ' + (state.step + 1) + ' of ' + STEPS.length;
  }

  function renderStage() {
    var b = box(), si = size(), cap = P.capacity(state.cfg, CAT);
    var dims = si.dims.slice();
    if (b.shape === 'square') dims[1] = dims[0];
    if (b.shape === 'round') dims = [dims[0], dims[2]];
    els.stageTitle.innerHTML = esc(b.name) + ' <span>' + esc(si.label) + ' · ' + (b.shape === 'round' ? 'Ø ' + dims[0] + ' × ' + dims[1] : dims.join(' × ')) + ' cm</span>';
    var pct = Math.min(100, Math.round((cap.used / cap.capacity) * 100));
    els.capacity.innerHTML = '<div class="kh-meter' + (cap.over ? ' is-over' : (pct > 85 ? ' is-near' : '')) + '" role="meter" aria-valuemin="0" aria-valuemax="' + cap.capacity + '" aria-valuenow="' + Math.min(cap.used, cap.capacity) + '" aria-label="Space used in the box"><span style="width:' + pct + '%"></span></div>' +
      '<p>' + (cap.over ? '<strong>Over capacity:</strong> ' : '') + cap.used + ' of ' + cap.capacity + ' spaces used <span class="kh-approx">· approximate fit, from typical product sizes</span></p>' +
      '<p class="kh-tight" id="kh-tight"' + (state.layoutTight && !cap.over ? '' : ' hidden') + '>Tight fit in the preview. We will confirm the arrangement on your mockup.</p>';
    if (preview) preview.render(state.cfg, CAT, { logoUrl: state.logo ? state.logo.preview : null, pricing: P });
    var st = preview ? preview.state() : { view: 'front', lidClosed: false };
    els.stageTools.querySelectorAll('[data-view]').forEach(function (b2) { b2.setAttribute('aria-pressed', String(b2.getAttribute('data-view') === st.view)); });
    var lidBtn = els.stageTools.querySelector('[data-act="lid"]');
    var noLid = b.lid === 'none' || st.view === 'top' || st.view === 'inside';
    lidBtn.disabled = noLid;
    lidBtn.textContent = st.lidClosed ? 'Open lid' : 'Close lid';
    els.stageWrap.classList.toggle('is-collapsed', state.previewHidden);
    els.previewToggle.textContent = state.previewHidden ? 'Show preview' : 'Hide preview';
    els.previewToggle.setAttribute('aria-expanded', String(!state.previewHidden));
  }

  function renderCapacityNote() {
    var n = document.getElementById('kh-tight');
    if (n) n.hidden = !(state.layoutTight && !P.capacity(state.cfg, CAT).over);
  }

  function line(label, amount, opts) {
    opts = opts || {};
    return '<div class="kh-line' + (opts.cls ? ' ' + opts.cls : '') + '"><span class="kh-line-l">' + label + '</span><span class="kh-line-a">' + (typeof amount === 'number' ? fmt(amount) : amount) + '</span></div>';
  }

  function renderSummary() {
    var pr = price(), iss = issues();
    var groups = [
      { id: 'box', label: 'Box and packaging', match: ['box', 'upgrade', 'filling'] },
      { id: 'products', label: 'Products', match: ['products'] },
      { id: 'personal', label: 'Personalisation', match: ['personal'] },
      { id: 'finishing', label: 'Finishing touches', match: ['finishing'] }
    ];
    var html = '<div class="kh-sum-head"><h2 id="kh-sum-title">Your hamper</h2>' + (pr.demo ? '<span class="kh-chip kh-chip-demo" title="Prices are demonstration values until KORE adds real rates">Demo prices</span>' : '') + '</div>';
    groups.forEach(function (g) {
      var ls = pr.lines.filter(function (l) { return g.match.indexOf(l.group) >= 0; });
      html += '<section class="kh-sum-group" aria-label="' + esc(g.label) + '"><h3>' + esc(g.label) + '</h3>';
      if (!ls.length) html += '<p class="kh-sum-empty">' + (g.id === 'products' ? 'No products yet' : 'None') + '</p>';
      ls.forEach(function (l) {
        html += line(esc(l.label) + (l.qty > 1 ? ' <span class="kh-qty">' + l.qty + ' × ' + fmt(l.unit) + '</span>' : ''), l.amount);
      });
      html += '</section>';
    });
    html += '<div class="kh-sum-totals">';
    html += line('Price per hamper', pr.perHamper, { cls: 'is-strong' });
    if (pr.bulkTier) html += line(esc(pr.bulkTier.label || 'Volume discount') + ' (' + pr.bulkTier.discountPct + '%)', '−' + fmt(pr.discountPerHamper * pr.hampers));
    html += line('Hampers', '× ' + pr.hampers.toLocaleString('en-IN'));
    html += line('Subtotal', pr.subtotal);
    html += line(esc(pr.taxLabel), pr.tax == null ? '<em>On quotation</em>' : pr.tax);
    html += line('Delivery', pr.delivery == null ? '<em>On quotation</em>' : pr.delivery);
    html += '<div class="kh-grand"><span>Estimated total</span><strong>' + fmt(pr.grandTotal) + '</strong></div>';
    if (pr.tax == null || pr.delivery == null) html += '<p class="kh-fine">Excludes ' + [pr.tax == null ? esc(pr.taxLabel) : '', pr.delivery == null ? 'delivery' : ''].filter(Boolean).join(' and ') + ', which KORE confirms on your quotation.</p>';
    html += '</div>';
    if (iss.errors.length) html += '<button type="button" class="kh-sum-issues" data-act="goto" data-step="' + stepIndex('review') + '">' + iss.errors.length + (iss.errors.length === 1 ? ' thing needs' : ' things need') + ' fixing before you order</button>';
    if (state.step !== stepIndex('review') && state.step !== stepIndex('order')) html += '<button type="button" class="kh-btn kh-btn-line kh-wide" data-act="goto" data-step="' + stepIndex('review') + '">Review hamper</button>';
    els.summary.innerHTML = html;
    els.summary.classList.toggle('is-open', state.summaryOpen);
  }

  function renderMobileBar() {
    var pr = price();
    els.mobileBar.innerHTML = '<div><span>Per hamper</span><strong>' + fmt(pr.perHamper) + '</strong></div><div><span>Total · ' + pr.hampers + '</span><strong>' + fmt(pr.grandTotal) + '</strong></div>' +
      '<button type="button" class="kh-btn kh-btn-solid" data-act="summary" aria-expanded="' + state.summaryOpen + '" aria-controls="kh-summary">' + (state.summaryOpen ? 'Close' : 'Summary') + '</button>';
  }

  /* ---------- shared bits of markup ---------- */
  function swatches(groupLabel, allowed, all, current, act, extra) {
    return '<div class="kh-swatches" role="radiogroup" aria-label="' + esc(groupLabel) + '">' + all.map(function (id) {
      var c = CAT.colours[id], ok = allowed.indexOf(id) >= 0, on = id === current;
      return '<button type="button" class="kh-sw' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '"' + (ok ? '' : ' disabled') +
        ' data-act="' + act + '" data-value="' + id + '"' + (extra || '') + ' title="' + esc(c.label) + (ok ? '' : ' (not available)') + '">' +
        '<span class="kh-sw-dot" style="--sw:' + c.hex + '"></span><span>' + esc(c.label) + (ok ? '' : '<span class="kh-sr"> (not available)</span>') + '</span></button>';
    }).join('') + '</div>';
  }
  function counter(id, val, max) { return '<span class="kh-count" id="' + id + '-count" aria-live="polite">' + (val || '').length + ' / ' + max + '</span>'; }
  function field(id, label, val, max, bindAttr, opts) {
    opts = opts || {};
    var input = opts.textarea
      ? '<textarea id="' + id + '" ' + bindAttr + ' maxlength="' + max + '" rows="' + (opts.rows || 3) + '"' + (opts.disabled ? ' disabled' : '') + ' aria-describedby="' + id + '-count' + (opts.help ? ' ' + id + '-help' : '') + '">' + esc(val) + '</textarea>'
      : '<input id="' + id + '" type="text" ' + bindAttr + ' maxlength="' + max + '" value="' + esc(val) + '"' + (opts.disabled ? ' disabled' : '') + ' aria-describedby="' + id + '-count' + (opts.help ? ' ' + id + '-help' : '') + '" autocomplete="off">';
    return '<div class="kh-field"><div class="kh-field-top"><label for="' + id + '">' + esc(label) + '</label>' + counter(id, val, max) + '</div>' + input + (opts.help ? '<p class="kh-help" id="' + id + '-help">' + opts.help + '</p>' : '') + '</div>';
  }
  function chips(groupLabel, options, current, act, extra) {
    return '<div class="kh-chips" role="radiogroup" aria-label="' + esc(groupLabel) + '">' + options.map(function (o) {
      var on = o.id === current;
      return '<button type="button" class="kh-chipbtn' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="' + act + '" data-value="' + esc(o.id) + '"' + (extra || '') + (o.disabled ? ' disabled' : '') + (o.style ? ' style="' + o.style + '"' : '') + '>' + esc(o.label) + (o.note ? ' <small>' + esc(o.note) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function issueList(list, kind) {
    if (!list.length) return '';
    return '<div class="kh-issues kh-issues-' + kind + '" role="' + (kind === 'error' ? 'alert' : 'status') + '"><ul>' + list.map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') + '</ul></div>';
  }

  /* ---------- step panels ---------- */
  function panelBox() {
    var cfg = state.cfg, cur = box();
    var cards = CAT.boxes.map(function (b) {
      var sizes = P.boxSizes(b);
      var on = b.id === cfg.boxId;
      var hexId = on ? cfg.colours.exterior : b.colours.exterior[0];
      return '<button type="button" class="kh-opt kh-opt-box' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-act="box" data-value="' + b.id + '"' + (b.available === false ? ' disabled' : '') + '>' +
        '<span class="kh-opt-art">' + V.boxThumb(b.shape, CAT.colours[hexId].hex, { lid: b.lid, texture: b.texture }) + '</span>' +
        '<span class="kh-opt-body"><span class="kh-opt-name">' + esc(b.name) + '</span>' +
        '<span class="kh-opt-meta">' + esc(b.material) + '</span>' +
        '<span class="kh-opt-desc">' + esc(b.description) + '</span>' +
        '<span class="kh-opt-foot"><span>From ' + fmt(b.sizes[sizes[0]]) + '</span><span>' + sizes.map(function (s) { return CAT.sizes[s].label; }).join(', ') + '</span></span>' +
        '<span class="kh-opt-foot"><span class="kh-mini-sw">' + b.colours.exterior.slice(0, 7).map(function (c) { return '<i style="--sw:' + CAT.colours[c].hex + '" title="' + esc(CAT.colours[c].label) + '"></i>'; }).join('') + '</span><span class="kh-avail">' + (b.available === false ? 'Unavailable' : 'Available') + '</span></span>' +
        '</span></button>';
    }).join('');
    var sizes = P.boxSizes(cur).map(function (s) {
      var si = P.sizeInfo(CAT, cur, s), on = s === cfg.size;
      var dims = si.dims.slice(); if (cur.shape === 'square') dims[1] = dims[0];
      var dimTxt = cur.shape === 'round' ? 'Ø ' + dims[0] + ' × ' + dims[2] + ' cm' : dims.join(' × ') + ' cm';
      return '<button type="button" class="kh-size' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="size" data-value="' + s + '"><strong>' + si.label + '</strong><span>' + dimTxt + '</span><span>Holds ' + si.capacity + ' spaces</span><span class="kh-size-p">' + fmt(cur.sizes[s]) + '</span></button>';
    }).join('');
    return '<div class="kh-grid kh-grid-box">' + cards + '</div>' +
      '<h3 class="kh-sub">Size for the ' + esc(cur.name.toLowerCase()) + '</h3>' +
      '<div class="kh-sizes" role="radiogroup" aria-label="Box size">' + sizes + '</div>' +
      '<p class="kh-help">Each product uses some space (shown on its card). Need a size we do not list? Add it to your special instructions and we will quote it.</p>';
  }

  function panelFilling() {
    var cfg = state.cfg, si = size();
    var all = [];
    CAT.fillings.forEach(function (f) { f.colours.forEach(function (c) { if (all.indexOf(c) < 0) all.push(c); }); });
    var cards = CAT.fillings.map(function (f) {
      var on = f.id === cfg.fillingId;
      var cHex = f.colours.length ? CAT.colours[on && cfg.fillingColour ? cfg.fillingColour : f.colours[0]].hex : null;
      var p = Math.round(f.price * si.fillFactor);
      return '<button type="button" class="kh-opt kh-opt-fill' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-act="filling" data-value="' + f.id + '">' +
        '<span class="kh-tex" style="background:' + (f.texture === 'none' ? 'var(--surface-2)' : V.texture(f.texture, cHex)) + '"></span>' +
        '<span class="kh-opt-body"><span class="kh-opt-name">' + esc(f.name) + '</span><span class="kh-opt-desc">' + esc(f.description) + '</span>' +
        '<span class="kh-opt-foot"><span>' + (p ? fmt(p) + ' for a ' + si.label.toLowerCase() + ' box' : 'No charge') + '</span><span>' + (f.colours.length ? f.colours.length + (f.colours.length === 1 ? ' colour' : ' colours') : '') + '</span></span></span></button>';
    }).join('');
    var f = P.findFilling(CAT, cfg.fillingId);
    var col = f.colours.length ? '<h3 class="kh-sub">' + esc(f.name) + ' colour</h3>' + swatches('Filling colour', f.colours, all, cfg.fillingColour, 'fill-colour') : '';
    return '<div class="kh-grid kh-grid-2">' + cards + '</div>' + col + '<p class="kh-help">Filling is priced by box size: a larger box needs more of it.</p>';
  }

  function productCard(p) {
    var cfg = state.cfg;
    var item = cfg.items.filter(function (it) { return it.productId === p.id; })[0];
    var colHex = item && item.colour ? CAT.colours[item.colour].hex : (p.colours.length ? CAT.colours[p.colours[0]].hex : null);
    var art = p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : V.icon(p.icon, colHex);
    var methods = p.personal ? p.personal.methods.map(function (m) { return CAT.methods[m].label.toLowerCase(); }).join(', ') : '';
    var controls;
    if (item) {
      controls = '<div class="kh-qtyrow"><div class="kh-stepper" role="group" aria-label="Quantity of ' + esc(p.name) + ' per hamper">' +
        '<button type="button" data-act="dec" data-uid="' + item.uid + '" aria-label="One fewer"' + (item.qty <= 1 ? ' disabled' : '') + '>−</button>' +
        '<output aria-live="polite">' + item.qty + '</output>' +
        '<button type="button" data-act="inc" data-uid="' + item.uid + '" aria-label="One more"' + (item.qty >= p.maxPerHamper ? ' disabled' : '') + '>+</button></div>' +
        '<button type="button" class="kh-link kh-danger" data-act="remove" data-uid="' + item.uid + '">Remove</button></div>';
      if (p.variants) controls += '<label class="kh-inline" for="var-' + item.uid + '">Size <select id="var-' + item.uid + '" data-change="variant" data-uid="' + item.uid + '">' + p.variants.map(function (v) { return '<option' + (v === item.variant ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></label>';
    } else {
      controls = '<button type="button" class="kh-btn kh-btn-line" data-act="add" data-value="' + p.id + '"' + (p.available === false ? ' disabled' : '') + '>Add to hamper</button>';
    }
    return '<article class="kh-prod' + (item ? ' is-in' : '') + '" aria-label="' + esc(p.name) + '">' +
      '<div class="kh-prod-art">' + art + (item ? '<span class="kh-badge">In hamper</span>' : '') + '</div>' +
      '<div class="kh-prod-body"><h4>' + esc(p.name) + '</h4><p>' + esc(p.description) + '</p>' +
      '<div class="kh-prod-meta"><strong>' + fmt(p.price) + '</strong><span>' + p.volume + (p.volume === 1 ? ' space' : ' spaces') + '</span>' + (p.personal ? '<span class="kh-chip">Personalisable</span>' : '') + '</div>' +
      (p.colours.length ? '<div class="kh-mini-sw" aria-label="' + p.colours.length + ' colours">' + p.colours.map(function (c) { return '<i style="--sw:' + CAT.colours[c].hex + '" title="' + esc(CAT.colours[c].label) + '"></i>'; }).join('') + '</div>' : '') +
      '<details class="kh-details"><summary>Details</summary><dl>' +
      (p.variants ? '<dt>Sizes</dt><dd>' + p.variants.join(', ') + (p.variantPrices ? ' (' + Object.keys(p.variantPrices).map(function (v) { return v + ' +' + fmt(p.variantPrices[v]); }).join(', ') + ')' : '') + '</dd>' : '') +
      '<dt>Personalisation</dt><dd>' + (p.personal ? esc(methods) + ' from ' + fmt(Math.min.apply(null, p.personal.methods.map(function (m) { return CAT.methods[m].charge; }))) + ' per item' : 'Not available') + '</dd>' +
      '<dt>Per hamper</dt><dd>Up to ' + p.maxPerHamper + '</dd>' +
      '<dt>Availability</dt><dd>' + (p.available === false ? 'Unavailable' : (p.stock == null ? 'Available' : p.stock + ' in stock')) + '</dd>' +
      (p.fragile ? '<dt>Note</dt><dd>Fragile</dd>' : '') + (p.minSize ? '<dt>Box</dt><dd>' + CAT.sizes[p.minSize].label + ' or larger</dd>' : '') +
      '</dl></details>' + controls + '</div></article>';
  }

  function productGridHtml() {
    var q = state.prodQuery.trim().toLowerCase();
    var list = CAT.products.filter(function (p) {
      if (state.prodCat !== 'all' && p.category !== state.prodCat) return false;
      if (!q) return true;
      return (p.name + ' ' + p.description + ' ' + p.category).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) return '<p class="kh-empty">No products match “' + esc(state.prodQuery) + '”. Try another word or a different category.</p>';
    return list.map(productCard).join('');
  }

  function panelProducts() {
    var cfg = state.cfg, cap = P.capacity(cfg, CAT);
    var counts = {};
    CAT.products.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    var cats = [{ id: 'all', label: 'All', n: CAT.products.length }].concat(CAT.categories.map(function (c) { return { id: c.id, label: c.label, n: counts[c.id] || 0 }; }));
    var inHamper = cfg.items.length
      ? '<ul class="kh-inlist">' + cfg.items.map(function (it) { var p = P.findProduct(CAT, it.productId); return '<li><span>' + it.qty + ' × ' + esc(p.name) + '</span><button type="button" class="kh-link kh-danger" data-act="remove" data-uid="' + it.uid + '" aria-label="Remove ' + esc(p.name) + '">Remove</button></li>'; }).join('') + '</ul>'
      : '<p class="kh-help">Nothing added yet. Start with something your recipients will use every day.</p>';
    var iss = issues();
    return '<div class="kh-inhamper"><div class="kh-inhamper-top"><strong>In your hamper</strong><span>' + cap.used + ' of ' + cap.capacity + ' spaces</span></div>' + inHamper + '</div>' +
      issueList(stepIssues('products', iss.errors), 'error') +
      '<div class="kh-search"><label for="kh-q" class="kh-sr">Search products</label><input id="kh-q" type="search" placeholder="Search bottles, notebooks, tea…" value="' + esc(state.prodQuery) + '" data-input="search" autocomplete="off"></div>' +
      '<div class="kh-cats" role="tablist" aria-label="Product categories">' + cats.map(function (c) {
        var on = c.id === state.prodCat;
        return '<button type="button" role="tab" aria-selected="' + on + '" class="kh-cat' + (on ? ' is-on' : '') + '" data-act="cat" data-value="' + c.id + '">' + esc(c.label) + ' <small>' + c.n + '</small></button>';
      }).join('') + '</div>' +
      '<div class="kh-prodgrid" id="kh-prodgrid">' + productGridHtml() + '</div>';
  }

  function panelColours() {
    var cfg = state.cfg, b = box();
    var allExt = [], allInt = [];
    CAT.boxes.forEach(function (bx) {
      bx.colours.exterior.forEach(function (c) { if (allExt.indexOf(c) < 0) allExt.push(c); });
      bx.colours.interior.forEach(function (c) { if (allInt.indexOf(c) < 0) allInt.push(c); });
    });
    var html = '<p class="kh-lede">Colours shown faded are not made for the ' + esc(b.name.toLowerCase()) + '.</p>';
    html += '<h3 class="kh-sub">Box exterior · <span class="kh-cur">' + esc(P.colourLabel(CAT, cfg.colours.exterior)) + '</span></h3>' + swatches('Box exterior', b.colours.exterior, allExt, cfg.colours.exterior, 'colour', ' data-part="exterior"');
    if (b.colours.lid.length) html += '<h3 class="kh-sub">Lid · <span class="kh-cur">' + esc(P.colourLabel(CAT, cfg.colours.lid)) + '</span></h3>' + swatches('Lid', b.colours.lid, allExt.concat(['gold']).filter(function (v, i, a) { return a.indexOf(v) === i; }), cfg.colours.lid, 'colour', ' data-part="lid"');
    html += '<h3 class="kh-sub">Box interior · <span class="kh-cur">' + esc(P.colourLabel(CAT, cfg.colours.interior)) + '</span></h3>' + swatches('Box interior', b.colours.interior, allInt, cfg.colours.interior, 'colour', ' data-part="interior"');
    html += '<h3 class="kh-sub">Interior lining</h3><div class="kh-chips" role="radiogroup" aria-label="Interior lining">' + b.linings.map(function (l) {
      var on = l.id === cfg.lining;
      return '<button type="button" class="kh-chipbtn' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="lining" data-value="' + l.id + '">' + esc(l.label) + ' <small>' + (l.price ? '+' + fmt(l.price) : 'Included') + '</small></button>';
    }).join('') + '</div>';
    var f = P.findFilling(CAT, cfg.fillingId);
    if (f.colours.length) {
      var allF = []; CAT.fillings.forEach(function (x) { x.colours.forEach(function (c) { if (allF.indexOf(c) < 0) allF.push(c); }); });
      html += '<h3 class="kh-sub">Filling · ' + esc(f.name) + ' · <span class="kh-cur">' + esc(P.colourLabel(CAT, cfg.fillingColour)) + '</span></h3>' + swatches('Filling colour', f.colours, allF, cfg.fillingColour, 'fill-colour');
    }
    var ribbonId = cfg.finishing.filter(function (id) { var x = P.findFinishing(CAT, id); return x && x.group === 'ribbon'; })[0];
    if (ribbonId) {
      var r = P.findFinishing(CAT, ribbonId);
      html += '<h3 class="kh-sub">Ribbon · ' + esc(r.name) + ' · <span class="kh-cur">' + esc(P.colourLabel(CAT, cfg.colours.ribbon)) + '</span></h3>' + swatches('Ribbon colour', r.colours, r.colours, cfg.colours.ribbon, 'ribbon-colour');
    } else html += '<h3 class="kh-sub">Ribbon</h3><p class="kh-help">Add a ribbon in <button type="button" class="kh-link" data-act="goto" data-step="' + stepIndex('finishing') + '">Finishing touches</button> to choose its colour.</p>';
    var withColours = cfg.items.filter(function (it) { return P.findProduct(CAT, it.productId).colours.length; });
    html += '<h3 class="kh-sub">Products</h3>';
    if (!withColours.length) html += '<p class="kh-help">' + (cfg.items.length ? 'Your products come in fixed packaging colours.' : 'Add products to choose their colours.') + '</p>';
    withColours.forEach(function (it) {
      var p = P.findProduct(CAT, it.productId);
      html += '<div class="kh-prodcol"><div class="kh-prodcol-art">' + V.icon(p.icon, CAT.colours[it.colour].hex) + '</div><div><h4>' + esc(p.name) + ' · <span class="kh-cur">' + esc(P.colourLabel(CAT, it.colour)) + '</span></h4>' + swatches(p.name + ' colour', p.colours, p.colours, it.colour, 'item-colour', ' data-uid="' + it.uid + '"') + '</div></div>';
    });
    return html;
  }

  function panelPersonalise() {
    var cfg = state.cfg, h = cfg.hamper, L = CAT.hamperPersonal.limits, b = box();
    var hasRibbon = !!cfg.colours.ribbon;
    var logo = state.logo;
    var iss = issues();
    var html = '<p class="kh-lede">Two kinds of personalisation: <strong>on the hamper</strong> (box, ribbon, card) and <strong>on individual products</strong>. The preview shows a visual approximation; we send a production mockup for approval.</p>';
    html += issueList(stepIssues('personalise', iss.errors), 'error');

    html += '<section class="kh-block" aria-labelledby="kh-logo-h"><h3 class="kh-sub" id="kh-logo-h">Your logo</h3>' +
      (logo ? '<div class="kh-logo-row"><img src="' + esc(logo.preview) + '" alt="Uploaded logo preview"><div><strong>' + esc(logo.name) + '</strong><span>' + Math.round(logo.size / 1024) + ' KB</span><button type="button" class="kh-link kh-danger" data-act="logo-remove">Remove logo</button></div></div>'
        : '<label class="kh-upload" for="kh-logo"><span>Upload a logo</span><small>PNG, JPG or WebP, up to 2 MB. Use a transparent PNG for the cleanest print.</small></label>') +
      '<input id="kh-logo" class="kh-sr" type="file" accept="image/png,image/jpeg,image/webp" data-change="logo">' +
      (state.logoError ? '<p class="kh-err" role="alert">' + esc(state.logoError) + '</p>' : '') + '</section>';

    html += '<section class="kh-block" aria-labelledby="kh-hp-h"><h3 class="kh-sub" id="kh-hp-h">On the hamper</h3>' +
      '<div class="kh-form-grid">' +
      field('hp-company', 'Company or institution', h.company, L.company, 'data-bind="company"') +
      field('hp-name', 'Name', h.name, L.name, 'data-bind="name"', { help: 'A recipient or team name. Also used on the gift tag.' }) +
      field('hp-event', 'Event', h.event, L.event, 'data-bind="event"') +
      field('hp-greeting', 'Greeting', h.greeting, L.greeting, 'data-bind="greeting"', { help: 'Shown on the box and on a greeting card.' }) +
      field('hp-tagline', 'Tagline', h.tagline, L.tagline, 'data-bind="tagline"') +
      '</div>' +
      field('hp-message', 'Personal message', h.message, L.message, 'data-bind="message"', { textarea: true, rows: 4, help: 'Printed in full on the Custom message card (Finishing touches).' }) +
      field('hp-ribbon', 'Ribbon text', h.ribbonText, L.ribbonText, 'data-bind="ribbonText"', { disabled: !hasRibbon, help: hasRibbon ? 'Printed along the ribbon, +' + fmt(CAT.hamperPersonal.ribbonPrintCharge) + ' per hamper.' : 'Add a ribbon in Finishing touches to print on it.' }) +
      '<h4 class="kh-mini">Font</h4>' + chips('Font for the box text', CAT.fonts.map(function (f) { return { id: f.id, label: f.label, style: 'font-family:' + f.css.replace(/"/g, '&quot;') }; }), h.font, 'hp-font') +
      '<h4 class="kh-mini">Text colour</h4>' + swatches('Box text colour', CAT.textColours, CAT.textColours, h.textColour, 'hp-colour') +
      '<h4 class="kh-mini">Placement</h4>' + chips('Where the text goes', CAT.hamperPersonal.placements.map(function (p) {
        var need = p.requiresFinishing && cfg.finishing.indexOf(p.requiresFinishing) < 0;
        var noLid = p.id === 'lid' && b.lid === 'none';
        return { id: p.id, label: p.label, disabled: noLid, note: noLid ? 'no lid' : (need ? 'add in Finishing' : '') };
      }), h.placement, 'hp-place') +
      '<label class="kh-check"><input type="checkbox" data-change="hp-logo"' + (h.useLogo ? ' checked' : '') + (logo ? '' : ' disabled') + '> Print my logo on the box <small>+' + fmt(CAT.hamperPersonal.logoCharge) + ' per hamper' + (logo ? '' : ' · upload a logo first') + '</small></label>' +
      '<p class="kh-help">Box text printing is ' + fmt(CAT.hamperPersonal.printCharge) + ' per hamper when any of the fields above (except the message) are filled.</p></section>';

    var personalisable = cfg.items.filter(function (it) { return P.findProduct(CAT, it.productId).personal; });
    html += '<section class="kh-block" aria-labelledby="kh-pp-h"><h3 class="kh-sub" id="kh-pp-h">On individual products</h3>';
    if (!personalisable.length) html += '<p class="kh-help">' + (cfg.items.length ? 'None of your products can be personalised.' : 'Add products first. Personalisable ones are marked on their cards.') + '</p>';
    personalisable.forEach(function (it) {
      var p = P.findProduct(CAT, it.productId), pp = it.personal, spec = p.personal;
      var id = 'pp-' + it.uid;
      html += '<div class="kh-pp' + (pp.on ? ' is-on' : '') + '"><div class="kh-pp-head"><span class="kh-pp-art">' + V.icon(p.icon, it.colour ? CAT.colours[it.colour].hex : null) + '</span><span><strong>' + esc(p.name) + '</strong><small>' + it.qty + ' per hamper</small></span>' +
        '<label class="kh-switch"><input type="checkbox" role="switch" data-change="pp-on" data-uid="' + it.uid + '"' + (pp.on ? ' checked' : '') + '><span>Personalise</span></label></div>';
      if (pp.on) {
        var m = CAT.methods[pp.method];
        html += '<div class="kh-pp-body">' +
          '<h4 class="kh-mini">Method</h4>' + chips('Personalisation method for ' + p.name, spec.methods.map(function (k) { return { id: k, label: CAT.methods[k].label, note: '+' + fmt(CAT.methods[k].charge) }; }), pp.method, 'pp-method', ' data-uid="' + it.uid + '"') +
          (spec.fields.indexOf('text') >= 0 ? field(id + '-text', 'Text (name, initials or short message)', pp.text, spec.maxChars, 'data-ibind="text" data-uid="' + it.uid + '"') : '') +
          (spec.fields.indexOf('logo') >= 0 ? '<label class="kh-check"><input type="checkbox" data-change="pp-logo" data-uid="' + it.uid + '"' + (pp.logo ? ' checked' : '') + '> Add my logo' + (state.logo ? '' : ' <small>upload a logo above</small>') + '</label>' : '') +
          '<div class="kh-form-grid"><label class="kh-inline" for="' + id + '-pl">Placement <select id="' + id + '-pl" data-change="pp-place" data-uid="' + it.uid + '">' + spec.placements.map(function (x) { return '<option' + (x === pp.placement ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></label>' +
          '<label class="kh-inline" for="' + id + '-font">Font <select id="' + id + '-font" data-change="pp-font" data-uid="' + it.uid + '">' + CAT.fonts.map(function (f) { return '<option value="' + f.id + '"' + (f.id === pp.font ? ' selected' : '') + '>' + esc(f.label) + '</option>'; }).join('') + '</select></label></div>' +
          (pp.method === 'engrave' || pp.method === 'emboss' ? '<p class="kh-help">' + esc(m.label) + ' has no ink colour; the preview shows it as a tone.</p>' : '<h4 class="kh-mini">Text colour</h4>' + swatches('Text colour for ' + p.name, CAT.textColours, CAT.textColours, pp.textColour, 'pp-colour', ' data-uid="' + it.uid + '"')) +
          '<p class="kh-charge">' + esc(m.label) + ': ' + fmt(m.charge) + ' × ' + it.qty + ' = <strong>' + fmt(m.charge * it.qty) + '</strong> per hamper</p></div>';
      }
      html += '</div>';
    });
    html += '</section>';
    return html;
  }

  function panelFinishing() {
    var cfg = state.cfg, b = box();
    var hasRibbon = !!cfg.colours.ribbon;
    var cards = CAT.finishing.map(function (f) {
      var on = cfg.finishing.indexOf(f.id) >= 0;
      var reason = '';
      if (f.shapes && f.shapes.indexOf(b.shape) < 0) reason = 'Not for the ' + b.name.toLowerCase();
      else if (f.boxes && f.boxes.indexOf(b.id) < 0) reason = 'Rigid boxes only';
      else if (f.requires === 'ribbon' && !hasRibbon) reason = 'Add a ribbon first';
      var hex = f.group === 'ribbon' ? CAT.colours[on ? cfg.colours.ribbon : f.colours[0]].hex : null;
      var replaces = f.group && !on && cfg.finishing.some(function (id) { var x = P.findFinishing(CAT, id); return x && x.group === f.group; });
      return '<div class="kh-fin' + (on ? ' is-on' : '') + (reason ? ' is-off' : '') + '"><span class="kh-fin-art">' + V.icon(f.icon, hex) + '</span>' +
        '<div class="kh-fin-body"><h4>' + esc(f.name) + '</h4><p>' + esc(f.description) + '</p><div class="kh-fin-foot"><strong>' + fmt(f.price) + '</strong>' +
        (reason ? '<span class="kh-muted">' + esc(reason) + '</span>' : '<button type="button" class="kh-btn ' + (on ? 'kh-btn-solid' : 'kh-btn-line') + '" aria-pressed="' + on + '" data-act="finish" data-value="' + f.id + '">' + (on ? 'Added' : (replaces ? 'Swap in' : 'Add')) + '</button>') +
        '</div>' + (on && f.group === 'ribbon' ? swatches('Ribbon colour', f.colours, f.colours, cfg.colours.ribbon, 'ribbon-colour') : '') + '</div></div>';
    }).join('');
    var iss = issues();
    return '<p class="kh-lede">All optional. Cards in the same family (ribbons, wraps, cards) replace each other.</p>' + issueList(stepIssues('finishing', iss.warnings), 'warn') +
      '<div class="kh-fingrid">' + cards + '</div>' +
      '<button type="button" class="kh-link" data-act="next">Skip finishing touches</button>';
  }

  function panelReview() {
    var cfg = state.cfg, pr = price(), iss = issues(), d = P.describe(cfg, CAT);
    state.visited.review = true;
    var presets = [1, 10, 25, 50, 100];
    var html = '';
    if (iss.errors.length) html += '<div class="kh-issues kh-issues-error" role="alert"><p><strong>Fix ' + (iss.errors.length === 1 ? 'this' : 'these') + ' before ordering</strong></p><ul>' + iss.errors.map(function (e) { return '<li>' + esc(e.message) + ' <button type="button" class="kh-link" data-act="goto" data-step="' + stepIndex(e.step) + '">Fix in ' + esc(STEPS[stepIndex(e.step)].label) + '</button></li>'; }).join('') + '</ul></div>';
    if (iss.warnings.length) html += '<div class="kh-issues kh-issues-warn" role="status"><ul>' + iss.warnings.map(function (e) { return '<li>' + esc(e.message) + ' <button type="button" class="kh-link" data-act="goto" data-step="' + stepIndex(e.step) + '">Change</button></li>'; }).join('') + '</ul></div>';

    html += '<section class="kh-block" aria-labelledby="kh-qty-h"><h3 class="kh-sub" id="kh-qty-h">How many hampers?</h3>' +
      '<div class="kh-chips" role="radiogroup" aria-label="Quantity presets">' + presets.map(function (n) { var on = cfg.hampers === n; return '<button type="button" class="kh-chipbtn' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="hampers" data-value="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
      '<label class="kh-inline" for="kh-hampers">Custom quantity <input id="kh-hampers" type="number" inputmode="numeric" min="' + CAT.pricing.minHampers + '" max="' + CAT.pricing.maxHampersPerOrder + '" step="1" value="' + cfg.hampers + '" data-change="hampers"></label>' +
      '<div class="kh-qtysum"><div><span>Per hamper</span><strong>' + fmt(pr.netPerHamper) + '</strong></div><div><span>Hampers</span><strong>' + pr.hampers.toLocaleString('en-IN') + '</strong></div><div><span>Subtotal</span><strong>' + fmt(pr.subtotal) + '</strong></div></div>' +
      (CAT.pricing.bulkTiers.length ? '<p class="kh-help">Volume pricing: ' + CAT.pricing.bulkTiers.map(function (t) { return t.minHampers + '+ hampers, ' + t.discountPct + '% off'; }).join(' · ') + '</p>' : '<p class="kh-help">Volume pricing for large orders is confirmed on your quotation.</p>') +
      '</section>';

    if (pr.productTotals.length) {
      html += '<section class="kh-block" aria-labelledby="kh-tot-h"><h3 class="kh-sub" id="kh-tot-h">Units needed for the whole order</h3><div class="kh-tablewrap"><table class="kh-table"><thead><tr><th scope="col">Product</th><th scope="col">Per hamper</th><th scope="col">Total</th></tr></thead><tbody>' +
        pr.productTotals.map(function (t) { return '<tr><td>' + esc(t.name) + (t.variant ? ' (' + esc(t.variant) + ')' : '') + (t.colour ? ' · ' + esc(P.colourLabel(CAT, t.colour)) : '') + '</td><td>' + t.perHamper + '</td><td>' + t.total.toLocaleString('en-IN') + '</td></tr>'; }).join('') +
        '</tbody></table></div></section>';
    }

    function sect(title, stepId, rows) {
      return '<section class="kh-rev"><div class="kh-rev-head"><h3>' + esc(title) + '</h3><button type="button" class="kh-link" data-act="goto" data-step="' + stepIndex(stepId) + '">Edit</button></div>' +
        (rows.length ? '<ul>' + rows.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '<p class="kh-help">None</p>') + '</section>';
    }
    html += '<div class="kh-revgrid">' +
      sect('Box', 'box', [d.box, d.material]) +
      sect('Filling', 'filling', [d.filling]) +
      sect('Products', 'products', d.items) +
      sect('Colours and materials', 'colours', [d.colours, 'Lining: ' + d.lining]) +
      sect('Hamper personalisation', 'personalise', d.hamper) +
      sect('Finishing touches', 'finishing', d.finishing) +
      '</div>';

    html += '<div class="kh-actions">' +
      '<button type="button" class="kh-btn kh-btn-line" data-act="goto" data-step="0">Edit hamper</button>' +
      '<button type="button" class="kh-btn kh-btn-line" data-act="save">Save design</button>' +
      '<button type="button" class="kh-btn kh-btn-ghost kh-danger" data-act="reset">Reset</button>' +
      '</div>';
    return html;
  }

  function panelOrder() {
    if (state.result) return resultHtml();
    var c = state.customer, e = state.showErrors ? state.custErrors : {}, cfg = state.cfg, pr = price(), iss = issues();
    function inp(id, key, label, type, opts) {
      opts = opts || {};
      var err = e[key];
      var attrs = ' id="' + id + '" data-cbind="' + key + '"' + (opts.required ? ' required aria-required="true"' : '') + (err ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + (opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : '') + (opts.max ? ' maxlength="' + opts.max + '"' : '') + (opts.min ? ' min="' + opts.min + '"' : '') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '');
      var control = type === 'textarea' ? '<textarea' + attrs + ' rows="' + (opts.rows || 3) + '">' + esc(c[key]) + '</textarea>'
        : type === 'select' ? '<select' + attrs + '>' + opts.options.map(function (o) { return '<option' + (o === c[key] ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'
          : '<input type="' + type + '"' + attrs + ' value="' + esc(c[key]) + '">';
      return '<div class="kh-field' + (opts.wide ? ' kh-wide' : '') + '"><label for="' + id + '">' + esc(label) + (opts.required ? ' <span aria-hidden="true">*</span>' : ' <small>optional</small>') + '</label>' + control + (opts.help ? '<p class="kh-help">' + esc(opts.help) + '</p>' : '') + (err ? '<p class="kh-err" id="' + id + '-err">' + esc(err) + '</p>' : '') + '</div>';
    }
    var html = '<p class="kh-lede">This sends a <strong>quotation request</strong>. No payment is taken. KORE confirms prices, ' + esc(pr.taxLabel) + ', delivery and a mockup before anything is made.</p>';
    if (iss.errors.length) html += '<div class="kh-issues kh-issues-error" role="alert"><p><strong>Your hamper needs a few fixes first.</strong></p><ul>' + iss.errors.map(function (er) { return '<li>' + esc(er.message) + ' <button type="button" class="kh-link" data-act="goto" data-step="' + stepIndex(er.step) + '">Fix</button></li>'; }).join('') + '</ul></div>';
    html += '<form id="kh-orderform" novalidate>' +
      '<fieldset><legend>Contact</legend><div class="kh-form-grid">' +
      inp('c-name', 'name', 'Your name', 'text', { required: true, autocomplete: 'name', max: 80 }) +
      inp('c-email', 'email', 'Email', 'email', { required: true, autocomplete: 'email', max: 120 }) +
      inp('c-phone', 'phone', 'Phone', 'tel', { required: true, autocomplete: 'tel', max: 20, inputmode: 'tel' }) +
      inp('c-company', 'company', 'Company or institution', 'text', { autocomplete: 'organization', max: 100 }) +
      inp('c-contact', 'contactMethod', 'Preferred contact', 'select', { options: ['Email', 'Phone call', 'WhatsApp'] }) +
      '</div></fieldset>' +
      '<fieldset><legend>Order</legend><div class="kh-form-grid">' +
      '<div class="kh-field"><label for="c-hampers">Number of hampers <span aria-hidden="true">*</span></label><input id="c-hampers" type="number" inputmode="numeric" min="' + CAT.pricing.minHampers + '" max="' + CAT.pricing.maxHampersPerOrder + '" step="1" value="' + cfg.hampers + '" data-change="hampers" required aria-required="true"></div>' +
      inp('c-event', 'event', 'Event name', 'text', { max: 100 }) +
      inp('c-date', 'deliveryDate', 'Delivery date', 'date', { min: P.earliestDelivery(CAT), help: 'Earliest available: ' + P.earliestDelivery(CAT) }) +
      inp('c-budget', 'budget', 'Budget per hamper', 'select', { options: ['', 'Under ₹1,500', '₹1,500 – ₹3,000', '₹3,000 – ₹5,000', 'Above ₹5,000'] }) +
      inp('c-loc', 'location', 'Delivery location', 'textarea', { wide: true, rows: 2, max: 600, help: 'City and PIN code, or "multiple addresses" and we will collect the list.' }) +
      '</div></fieldset>' +
      '<fieldset><legend>Billing</legend><div class="kh-form-grid">' +
      inp('c-billing', 'billing', 'Billing name and address', 'textarea', { wide: true, rows: 2, max: 600 }) +
      inp('c-gstin', 'gstin', 'GSTIN', 'text', { max: 15, help: 'For a GST invoice in your company name.' }) +
      '</div></fieldset>' +
      inp('c-notes', 'instructions', 'Special instructions', 'textarea', { wide: true, rows: 4, max: 2000, help: 'Bulk-order notes, delivery requirements, custom sizes or anything else we should know.' }) +
      '<label class="kh-check' + (e.acceptQuote ? ' has-err' : '') + '"><input type="checkbox" id="c-accept" data-cbind="acceptQuote"' + (c.acceptQuote ? ' checked' : '') + (e.acceptQuote ? ' aria-invalid="true" aria-describedby="c-accept-err"' : '') + '> I understand this is a quotation request and KORE will confirm prices before any payment.</label>' +
      (e.acceptQuote ? '<p class="kh-err" id="c-accept-err">' + esc(e.acceptQuote) + '</p>' : '') +
      '<div class="kh-ordertotal"><span>' + cfg.hampers.toLocaleString('en-IN') + (cfg.hampers === 1 ? ' hamper' : ' hampers') + ' × ' + fmt(pr.netPerHamper) + '</span><strong>' + fmt(pr.grandTotal) + '</strong><small>Estimated total' + (pr.tax == null ? ', excluding ' + esc(pr.taxLabel) : '') + (pr.delivery == null ? ' and delivery' : '') + '</small></div>' +
      (state.submitError ? '<div class="kh-issues kh-issues-error" role="alert"><p>' + esc(state.submitError) + '</p></div>' : '') +
      '<button type="submit" class="kh-btn kh-btn-solid kh-btn-lg"' + (state.submitting ? ' disabled aria-busy="true"' : '') + '>' + (state.submitting ? 'Sending…' : 'Send quotation request') + '</button>' +
      '<p class="kh-help">Sending opens an email to KORE with your whole order typed in. Press Send in that email to deliver it.</p>' +
      '</form>';
    return html;
  }

  function resultHtml() {
    var r = state.result, m = r.draft, saved = r.saved !== false;
    var emailLine = saved ? ({
      sent: 'KORE has also been notified by email.',
      failed: 'Your request is saved, but the notification email to KORE did not go through. It is flagged so our team can resend it.',
      not_configured: ''
    }[r.emailStatus] || '') : '';
    var custLine = r.customerEmailStatus === 'sent' ? 'A copy has been emailed to ' + esc(r.email) + '.' : '';
    var draft = m ? '<div class="kh-draft"><h4>Your order email is ready to send</h4><p>' +
      (r.opened ? 'A draft opened in a new Gmail tab with your whole order already typed in. Press <strong>Send</strong> there to deliver it to KORE.' : 'Open the draft below, with your whole order already typed in, and press <strong>Send</strong> to deliver it to KORE.') + '</p>' +
      '<div class="kh-actions"><a class="kh-btn kh-btn-solid" href="' + esc(m.gmail) + '" target="_blank" rel="noopener">Open in Gmail</a><a class="kh-btn kh-btn-line" href="' + esc(m.mailto) + '">Open in your email app</a><button type="button" class="kh-btn kh-btn-ghost" data-act="copy-mail">Copy email text</button></div>' +
      '<label class="kh-help" for="kh-mailtext">To ' + esc(m.to) + ' · Subject: ' + esc(m.subject) + '</label>' +
      '<textarea id="kh-mailtext" class="kh-mailtext" readonly rows="14">' + esc(m.body) + '</textarea>' +
      (m.hasLogo ? '<p class="kh-help">You added a logo. Attach the file to the email before you send it.</p>' : '') +
      (m.shortened ? '<p class="kh-help">The draft was shortened to fit your email app. Use Copy email text for the complete order.</p>' : '') + '</div>' : '';
    return '<div class="kh-result" tabindex="-1" id="kh-result"><p class="kh-eyebrow">' + (saved ? 'Quotation request saved' : 'One last step') + '</p>' +
      (saved ? '<h3>Reference <span class="kh-nowrap">' + esc(r.reference) + '</span></h3>' : '<h3>Send your order email</h3>') +
      (emailLine || custLine ? '<p>' + esc(emailLine) + ' ' + custLine + '</p>' : '') +
      (!saved && !r.notConnected ? '<p class="kh-help">We could not save this request online just now, so the email below is how your order reaches KORE.</p>' : '') +
      draft +
      '<dl class="kh-resdl"><dt>Hampers</dt><dd>' + r.hampers.toLocaleString('en-IN') + '</dd><dt>Estimated total</dt><dd>' + fmt(r.total) + (r.verified ? '' : ' <small>(to be confirmed)</small>') + '</dd><dt>Status</dt><dd>' + (saved ? 'Awaiting quotation' : 'Waiting for you to send the email') + '</dd></dl>' +
      '<h4>What happens next</h4><ol class="kh-next"><li>We review your hamper and check stock.</li><li>We send a quotation with ' + esc(price().taxLabel) + ' and delivery, plus a digital mockup.</li><li>You approve, and we start production.</li></ol>' +
      '<div class="kh-actions"><button type="button" class="kh-btn kh-btn-line" data-act="goto" data-step="0">Edit this hamper</button><button type="button" class="kh-btn kh-btn-ghost" data-act="new">Start a new hamper</button></div></div>';
  }

  var PANELS = { box: panelBox, filling: panelFilling, products: panelProducts, colours: panelColours, personalise: panelPersonalise, finishing: panelFinishing, review: panelReview, order: panelOrder };

  function renderPanel(focusTitle) {
    var s = STEPS[state.step];
    state.visited[s.id] = true;
    els.stepTitle.textContent = s.title;
    els.panel.innerHTML = PANELS[s.id]();
    var prev = STEPS[state.step - 1], next = STEPS[state.step + 1];
    var nextLabel = s.id === 'review' ? 'Continue to your details' : (next ? 'Continue to ' + next.label : '');
    els.stepNav.innerHTML = (prev ? '<button type="button" class="kh-btn kh-btn-line" data-act="back">Back</button>' : '<span></span>') +
      (next && !(s.id === 'order') ? '<button type="button" class="kh-btn kh-btn-solid" data-act="next">' + esc(nextLabel) + '</button>' : '');
    els.stepNav.hidden = s.id === 'order' && !!state.result;
    if (focusTitle) {
      els.stepTitle.focus({ preventScroll: true });
      var top = els.controls.getBoundingClientRect().top + window.scrollY - 90;
      if (window.scrollY > top) window.scrollTo({ top: top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  function goto(i) {
    i = Math.max(0, Math.min(STEPS.length - 1, i));
    if (STEPS[i].id === 'order' && state.result && state.step !== i) { /* keep showing result */ }
    state.step = i;
    persist();
    renderPanel(true);
    renderLive();
  }

  /* ---------- toast and confirm ---------- */
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 6000);
  }
  function confirmBox(title, body, okLabel, onOk) {
    els.modal.innerHTML = '<div class="kh-modal-card" role="dialog" aria-modal="true" aria-labelledby="kh-m-t"><h2 id="kh-m-t">' + esc(title) + '</h2><p>' + esc(body) + '</p><div class="kh-actions"><button type="button" class="kh-btn kh-btn-line" data-m="cancel">Cancel</button><button type="button" class="kh-btn kh-btn-solid" data-m="ok">' + esc(okLabel) + '</button></div></div>';
    els.modal.hidden = false;
    var last = document.activeElement;
    els.modal.querySelector('[data-m="cancel"]').focus();
    function close() { els.modal.hidden = true; els.modal.innerHTML = ''; els.modal.removeEventListener('click', h); document.removeEventListener('keydown', k); if (last && last.focus) last.focus(); }
    function h(e) { var b = e.target.closest('[data-m]'); if (e.target === els.modal) close(); if (!b) return; close(); if (b.getAttribute('data-m') === 'ok') onOk(); }
    function k(e) { if (e.key === 'Escape') close(); }
    els.modal.addEventListener('click', h);
    document.addEventListener('keydown', k);
  }

  /* ---------- logo upload ---------- */
  function handleLogo(file) {
    var spec = CAT.hamperPersonal.logo;
    state.logoError = '';
    if (!file) return;
    if (spec.types.indexOf(file.type) < 0) { state.logoError = 'That file type is not supported. Upload a PNG, JPG or WebP image.'; renderPanel(); return; }
    if (file.size > spec.maxBytes) { state.logoError = 'That file is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is ' + (spec.maxBytes / 1048576) + ' MB.'; renderPanel(); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var original = reader.result;
      var img = new Image();
      img.onload = function () {
        var max = 512, s = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var prev;
        try { prev = cv.toDataURL('image/png'); if (prev.length > 240000) prev = cv.toDataURL('image/jpeg', 0.85); } catch (e) { prev = original; }
        state.logo = { name: file.name.slice(0, 120), type: file.type, size: file.size, width: img.width, height: img.height, preview: prev, original: original };
        store(CFG.storageKey + '-logo', prev.length < 300000 ? { name: state.logo.name, type: file.type, size: file.size, width: img.width, height: img.height, preview: prev } : null);
        commit(function (c) { c.hamper.useLogo = true; });
        toast('Logo added. It now shows on the box preview.');
      };
      img.onerror = function () { state.logoError = 'We could not read that image. Try exporting it again as PNG.'; renderPanel(); };
      img.src = original;
    };
    reader.onerror = function () { state.logoError = 'We could not read that file.'; renderPanel(); };
    reader.readAsDataURL(file);
  }

  /* ---------- order submission ---------- */
  var dbPromise = null, userPromise = null;
  function cap(name) {
    try { return window.claude && typeof window.claude.use === 'function' ? window.claude.use(name).catch(function () { return null; }) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
  }
  function getDb() { if (!dbPromise) dbPromise = cap('db'); return dbPromise; }
  function getUser() { if (!userPromise) userPromise = cap('user'); return userPromise; }

  function buildPayload() {
    var pr = price();
    return {
      catalogueVersion: CAT.meta.version,
      config: JSON.parse(JSON.stringify(state.cfg)),
      customer: P.cleanCustomer(state.customer),
      logo: state.logo ? { name: state.logo.name, type: state.logo.type, size: state.logo.size, width: state.logo.width, height: state.logo.height } : null,
      client: { perHamper: pr.perHamper, grandTotal: pr.grandTotal },
      submittedAt: new Date().toISOString()
    };
  }

  /* ---------- the order as a ready-to-send email ---------- */
  function buildOrderEmail(payload) {
    var pr = price(), cu = payload.customer, d = P.describe(state.cfg, CAT), to = CFG.orderEmail || 'koreexpression@gmail.com';
    function row(label, v) { return v ? label + ': ' + v : ''; }
    function sec(title, rows) { rows = rows.filter(Boolean); return rows.length ? [title].concat(rows, ['']) : []; }
    function build(full) {
      var est = ['ESTIMATE (calculated on the website; KORE confirms the final quotation)'];
      if (full) pr.lines.forEach(function (l) { est.push('  ' + l.label + (l.qty > 1 ? ' × ' + l.qty : '') + ': ' + fmt(l.amount)); });
      est.push('Per hamper: ' + fmt(pr.netPerHamper));
      est.push('Total for ' + pr.hampers.toLocaleString('en-IN') + (pr.hampers === 1 ? ' hamper: ' : ' hampers: ') + fmt(pr.grandTotal) + (pr.tax == null ? ' (excluding ' + pr.taxLabel + (pr.delivery == null ? ' and delivery' : '') + ')' : ''));
      if (pr.demo) est.push('(Website prices are placeholder rates until KORE confirms.)');
      var lines = [].concat(
        ['Hello KORE team,', '', 'Please send me a quotation and a digital mockup for the hamper below.', ''],
        sec('CONTACT', [row('Name', cu.name), row('Email', cu.email), row('Phone', cu.phone), row('Company', cu.company), row('Preferred contact', cu.contactMethod)]),
        sec('ORDER', [row('Number of hampers', String(state.cfg.hampers)), row('Event', cu.event), row('Delivery date', cu.deliveryDate), row('Budget per hamper', cu.budget), row('Delivery location', cu.location), row('Billing name and address', cu.billing), row('GSTIN', cu.gstin), row('Special instructions', cu.instructions)]),
        sec('HAMPER', [row('Box', d.box), row('Material', d.material), row('Colours', d.colours), row('Lining', d.lining), row('Filling', d.filling)]),
        d.items.length ? ['PRODUCTS'].concat(d.items.map(function (t, i) { return (i + 1) + '. ' + t; }), ['']) : [],
        d.hamper.length ? ['HAMPER PERSONALISATION'].concat(d.hamper.map(function (t) { return '- ' + t; }), ['']) : [],
        d.finishing.length ? ['FINISHING TOUCHES'].concat(d.finishing.map(function (t) { return '- ' + t; }), ['']) : [],
        state.logo ? ['LOGO', 'File: ' + state.logo.name + ' (I will attach it to this email)', ''] : [],
        est, ['', 'Thank you,', cu.name]
      );
      return lines.join('\n');
    }
    var subject = 'Quotation request: ' + pr.hampers.toLocaleString('en-IN') + ' × custom hamper (' + (cu.company || cu.name) + ')';
    function gmail(b) { return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(b); }
    function mailto(b) { return 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(b); }
    var full = build(true), compact = build(false);
    // very long drafts can be cut off by Gmail or an email app; fall back to the shorter version
    var gb = gmail(full).length <= 7000 ? full : compact, mb = mailto(full).length <= 6000 ? full : compact;
    return { to: to, subject: subject, body: full, gmail: gmail(gb), mailto: mailto(mb), shortened: gb !== full || mb !== full, hasLogo: !!state.logo };
  }

  function copyMail() {
    var ta = document.getElementById('kh-mailtext');
    if (!ta) return;
    function fallback() { ta.focus(); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } toast(ok ? 'Email text copied. Paste it into a new email.' : 'Select the text and copy it.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { toast('Email text copied. Paste it into a new email.'); }, fallback);
    else fallback();
  }

  function submitOrder() {
    var cust = P.cleanCustomer(state.customer);
    state.custErrors = P.validateCustomer(cust, CAT);
    state.showErrors = true;
    var iss = issues();
    state.submitError = '';
    if (Object.keys(state.custErrors).length || iss.errors.length) {
      state.submitError = iss.errors.length ? 'Fix the hamper issues listed above, then send again.' : 'Check the highlighted fields.';
      renderPanel();
      renderLive();
      var first = els.panel.querySelector('[aria-invalid="true"]') || els.panel.querySelector('.kh-issues-error');
      if (first) { first.focus && first.focus(); first.scrollIntoView({ block: 'center' }); }
      return;
    }
    state.submitting = true;
    renderPanel();
    var payload = buildPayload();
    var mail = buildOrderEmail(payload);
    var pr0 = price(), email0 = payload.customer.email;
    // Open the pre-filled Gmail draft straight from the click, so the browser allows the new tab.
    var opened = !!window.open(mail.gmail, '_blank');
    var job = CFG.orderEndpoint ? sendToServer(payload) : saveToInbox(payload);
    job.then(function (r) {
      r.saved = true; r.draft = mail; r.opened = opened;
      return r;
    }, function (err) {
      // Saving online did not work (not signed in, no connection, ...). The email draft is still the order.
      return { mode: 'draft', saved: false, notConnected: !!(err && err.code === 'no-backend'), saveNote: (err && err.message) || '', draft: mail, opened: opened, email: email0, hampers: pr0.hampers, total: pr0.grandTotal, verified: false };
    }).then(function (r) {
      state.result = r;
      state.submitting = false;
      renderPanel();
      var el = document.getElementById('kh-result');
      if (el) { el.focus(); el.scrollIntoView({ block: 'start' }); }
    });
  }

  function sendToServer(payload) {
    if (state.logo) payload.logo.data = state.logo.original;
    return fetch(CFG.orderEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.ok) {
            // The order API is not deployed or not set up yet: the email draft is the order.
            if ((data && data.code === 'not_configured') || res.status === 404 || res.status === 405) { var nb = new Error('Online saving is not set up.'); nb.code = 'no-backend'; throw nb; }
            var msg = data && data.errors && data.errors.length ? data.errors.map(function (e) { return e.message || e; }).join(' ') : 'The order service could not save your request (error ' + res.status + '). Your hamper is still here; please try again.';
            throw new Error(msg);
          }
          return { mode: 'server', reference: data.reference, emailStatus: data.emailStatus, customerEmailStatus: data.customerEmailStatus, email: payload.customer.email, hampers: data.pricing.hampers, total: data.pricing.grandTotal, verified: true };
        });
      }, function () { throw new Error('We could not reach the order service. Check your connection and try again; your hamper is saved in this browser.'); });
  }

  function saveToInbox(payload) {
    return Promise.all([getDb(), getUser()]).then(function (caps) {
      var db = caps[0], user = caps[1];
      if (!db || !user) { var nc = new Error('Online saving is not set up.'); nc.code = 'no-backend'; throw nc; }
      return user.id().then(function (uid) {
        if (!uid) throw new Error('Sign in to send a quotation request from this page.');
        var ref = P.makeReference();
        var pr = price();
        if (state.logo && state.logo.preview && state.logo.preview.length < 180000) payload.logo.preview = state.logo.preview;
        var doc = Object.assign(payload, {
          reference: ref, status: 'quotation_requested', createdAt: new Date().toISOString(),
          pricing: { perHamper: pr.perHamper, netPerHamper: pr.netPerHamper, hampers: pr.hampers, subtotal: pr.subtotal, tax: pr.tax, delivery: pr.delivery, grandTotal: pr.grandTotal, lines: pr.lines.map(function (l) { return { group: l.group, label: l.label, unit: l.unit, qty: l.qty, amount: l.amount }; }), productTotals: pr.productTotals, demo: pr.demo },
          pricingVerifiedBy: 'browser', emailStatus: 'not_configured',
          summary: P.describe(state.cfg, CAT)
        });
        return db.doc('orders/' + uid + '/requests/' + ref).set(doc).then(function () {
          return db.doc('orders/' + uid).set({ lastOrderAt: doc.createdAt, lastReference: ref }).catch(function () { /* index is optional */ });
        }).then(function () {
          return { mode: 'inbox', reference: ref, emailStatus: 'not_configured', email: payload.customer.email, hampers: pr.hampers, total: pr.grandTotal, verified: false };
        }, function (e) {
          var code = e && e.code;
          throw new Error(code === 'quota_exceeded' ? 'The order inbox is full. Please use the Enquire link and mention your hamper.' : 'We could not save your request just now. Your hamper is still here; please try again.');
        });
      });
    });
  }

  /* ---------- order inbox (editors of this page only) ---------- */
  function initInbox() {
    if (CFG.orderEndpoint) return;
    getUser().then(function (user) {
      if (!user || typeof user.canEdit !== 'function') return;
      return Promise.resolve(user.canEdit()).then(function (can) {
        if (!can) return;
        var b = els.header.querySelector('.kh-inbox-btn');
        if (b) b.hidden = false;
      });
    }).catch(function () { /* no inbox */ });
  }

  function loadInbox() {
    state.inbox.loading = true; state.inbox.error = '';
    renderInbox();
    getDb().then(function (db) {
      if (!db) throw new Error('The order inbox is not available in this view.');
      return db.collection('orders').get().then(function (snap) {
        return Promise.all(snap.docs.map(function (d) { return db.collection('orders/' + d.id + '/requests').get().then(function (s) { return s.docs.map(function (x) { return { path: 'orders/' + d.id + '/requests/' + x.id, data: x.data() }; }); }); }));
      });
    }).then(function (groups) {
      var all = [].concat.apply([], groups);
      all.sort(function (a, b) { return (b.data.createdAt || '').localeCompare(a.data.createdAt || ''); });
      state.inbox.orders = all;
      state.inbox.loading = false;
      renderInbox();
    }).catch(function (e) {
      state.inbox.loading = false;
      state.inbox.error = e.message || 'Could not load orders.';
      renderInbox();
    });
  }

  function renderInbox() {
    var ib = state.inbox;
    els.inbox.hidden = !ib.open;
    if (!ib.open) return;
    var html = '<div class="kh-inbox-head"><h2>Order inbox</h2><div class="kh-actions"><button type="button" class="kh-btn kh-btn-line" data-act="inbox-refresh">Refresh</button><button type="button" class="kh-btn kh-btn-ghost" data-act="inbox">Close</button></div></div>' +
      '<p class="kh-help">Quotation requests sent from this page. Only people who can edit the page see this.</p>';
    if (ib.loading) html += '<p>Loading orders…</p>';
    else if (ib.error) html += '<p class="kh-err">' + esc(ib.error) + '</p>';
    else if (!ib.orders.length) html += '<div class="kh-emptybox"><p><strong>No quotation requests yet.</strong></p><p>When a customer sends one from the Details step, it appears here with their hamper, quantities and contact details.</p></div>';
    else {
      html += ib.orders.map(function (o) {
        var d = o.data, c = d.customer || {}, s = d.summary || {};
        var statuses = [['quotation_requested', 'New request'], ['contacted', 'Contacted'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']];
        return '<details class="kh-order"><summary><span class="kh-order-ref">' + esc(d.reference) + '</span><span>' + esc(c.name || '') + (c.company ? ' · ' + esc(c.company) : '') + '</span><span>' + (d.pricing ? d.pricing.hampers + ' × ' + fmt(d.pricing.netPerHamper) : '') + '</span><strong>' + (d.pricing ? fmt(d.pricing.grandTotal) : '') + '</strong><span class="kh-chip">' + esc((statuses.filter(function (x) { return x[0] === d.status; })[0] || [0, d.status])[1]) + '</span></summary>' +
          '<div class="kh-order-body"><div class="kh-order-cols"><div><h4>Customer</h4><dl>' +
          [['Email', c.email], ['Phone', c.phone], ['Prefers', c.contactMethod], ['Event', c.event], ['Delivery date', c.deliveryDate], ['Location', c.location], ['Billing', c.billing], ['GSTIN', c.gstin], ['Budget', c.budget], ['Instructions', c.instructions], ['Sent', d.createdAt]].filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl></div>' +
          '<div><h4>Hamper</h4><ul>' + [s.box, s.colours, s.filling].concat(s.items || [], s.hamper || [], (s.finishing || []).map(function (f) { return 'Finishing: ' + f; })).filter(Boolean).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
          (d.logo && d.logo.preview ? '<p><img class="kh-order-logo" src="' + esc(d.logo.preview) + '" alt="Customer logo"></p>' : (d.logo ? '<p class="kh-help">Logo: ' + esc(d.logo.name) + ' (request the print file)</p>' : '')) +
          '<h4>Units for the order</h4><ul>' + ((d.pricing && d.pricing.productTotals) || []).map(function (t) { return '<li>' + esc(t.name) + ': ' + t.total + '</li>'; }).join('') + '</ul></div></div>' +
          '<label class="kh-inline">Status <select data-change="order-status" data-path="' + esc(o.path) + '">' + statuses.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === d.status ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
          '<p class="kh-help">Prices calculated in the customer’s browser from ' + esc(d.catalogueVersion || '') + (d.pricing && d.pricing.demo ? ' (demo prices)' : '') + '. Email: ' + esc(d.emailStatus) + '.</p></div></details>';
      }).join('');
    }
    els.inbox.innerHTML = html;
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    var act = t.getAttribute('data-act'), val = t.getAttribute('data-value'), uidv = t.getAttribute('data-uid');
    function item(c) { return c.items.filter(function (it) { return it.uid === uidv; })[0]; }
    switch (act) {
      case 'goto': goto(+t.getAttribute('data-step')); if (state.summaryOpen) { state.summaryOpen = false; renderLive(); } break;
      case 'next': goto(state.step + 1); break;
      case 'back': goto(state.step - 1); break;
      case 'box': commit(function (c) { c.boxId = val; }); break;
      case 'size': commit(function (c) { c.size = val; }); break;
      case 'filling': commit(function (c) { c.fillingId = val; }); break;
      case 'fill-colour': commit(function (c) { c.fillingColour = val; }); break;
      case 'colour': commit(function (c) { c.colours[t.getAttribute('data-part')] = val; }); break;
      case 'lining': commit(function (c) { c.lining = val; }); break;
      case 'ribbon-colour': commit(function (c) { c.colours.ribbon = val; }); break;
      case 'item-colour': commit(function (c) { var it = item(c); if (it) it.colour = val; }); break;
      case 'add':
        commit(function (c) { c.items.push(P.makeItem(CAT, val)); });
        var p = P.findProduct(CAT, val), capNow = P.capacity(state.cfg, CAT);
        toast(p.name + ' added.' + (capNow.over ? ' The box is now over capacity: choose a larger size or remove something.' : ''));
        break;
      case 'inc': commit(function (c) { var it = item(c); if (it) it.qty += 1; }); break;
      case 'dec': commit(function (c) { var it = item(c); if (it && it.qty > 1) it.qty -= 1; }); break;
      case 'remove': commit(function (c) { c.items = c.items.filter(function (it) { return it.uid !== uidv; }); }); toast('Removed from your hamper.'); break;
      case 'cat': state.prodCat = val; renderPanel(); break;
      case 'finish': commit(function (c) { var i = c.finishing.indexOf(val); if (i >= 0) c.finishing.splice(i, 1); else c.finishing.push(val); }); break;
      case 'hp-font': commit(function (c) { c.hamper.font = val; }); break;
      case 'hp-colour': commit(function (c) { c.hamper.textColour = val; }); break;
      case 'hp-place': commit(function (c) { c.hamper.placement = val; }); break;
      case 'pp-method': commit(function (c) { var it = item(c); if (it) it.personal.method = val; }); break;
      case 'pp-colour': commit(function (c) { var it = item(c); if (it) it.personal.textColour = val; }); break;
      case 'logo-remove':
        state.logo = null; store(CFG.storageKey + '-logo', null);
        commit(function (c) { c.hamper.useLogo = false; c.items.forEach(function (it) { it.personal.logo = false; }); });
        break;
      case 'hampers': commit(function (c) { c.hampers = +val; }); break;
      case 'save':
        persist();
        toast(store(CFG.storageKey + '-saved', { cfg: state.cfg, savedAt: Date.now() }) ? 'Design saved in this browser. Open this page on the same device to pick up where you left off.' : 'This browser is blocking storage, so the design could not be saved here.');
        break;
      case 'reset':
        confirmBox('Reset your hamper?', 'This clears every selection, product and personalisation. It cannot be undone.', 'Reset hamper', function () {
          state.cfg = P.normalize(P.defaultConfig(CAT), CAT).config;
          state.logo = null; store(CFG.storageKey + '-logo', null);
          state.result = null; state.visited = {}; state.prodCat = 'all'; state.prodQuery = '';
          persist();
          goto(0);
          toast('Hamper reset. Start by choosing a box.');
        });
        break;
      case 'new':
        state.cfg = P.normalize(P.defaultConfig(CAT), CAT).config;
        state.result = null; state.visited = {}; state.logo = null; store(CFG.storageKey + '-logo', null);
        persist(); goto(0);
        break;
      case 'empty-start':
        state.cfg = P.normalize(P.defaultConfig(CAT), CAT).config;
        persist(); renderAll(); hideSampleNote();
        break;
      case 'view': if (preview) { preview.setView(val); renderStage(); } break;
      case 'zoom-in': if (preview) preview.zoomBy(1.15); break;
      case 'zoom-out': if (preview) preview.zoomBy(1 / 1.15); break;
      case 'lid': if (preview) { preview.toggleLid(); renderStage(); } break;
      case 'view-reset': if (preview) { preview.resetView(); renderStage(); } break;
      case 'preview-toggle': state.previewHidden = !state.previewHidden; renderStage(); break;
      case 'summary': state.summaryOpen = !state.summaryOpen; renderSummary(); renderMobileBar(); if (state.summaryOpen) els.summary.focus(); break;
      case 'inbox': state.inbox.open = !state.inbox.open; if (state.inbox.open) loadInbox(); else renderInbox(); break;
      case 'inbox-refresh': loadInbox(); break;
      case 'copy-mail': copyMail(); break;
    }
  }

  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute('data-bind')) {
      var k = t.getAttribute('data-bind');
      state.cfg.hamper[k] = t.value;
      softCommit(t);
    } else if (t.hasAttribute('data-ibind')) {
      var uid2 = t.getAttribute('data-uid');
      var it = state.cfg.items.filter(function (x) { return x.uid === uid2; })[0];
      if (it) it.personal.text = t.value;
      softCommit(t);
    } else if (t.hasAttribute('data-cbind') && t.type !== 'checkbox') {
      state.customer[t.getAttribute('data-cbind')] = t.value;
    } else if (t.getAttribute('data-input') === 'search') {
      state.prodQuery = t.value;
      var grid = document.getElementById('kh-prodgrid');
      if (grid) grid.innerHTML = productGridHtml();
    }
  }

  /* text typing: update preview and price without rebuilding the inputs */
  function softCommit(t) {
    state.cfg.sample = false;
    state.result = null;
    hideSampleNote();
    var res = P.normalize(state.cfg, CAT);
    state.cfg = res.config;
    var c = document.getElementById(t.id + '-count');
    if (c) c.textContent = t.value.length + ' / ' + t.getAttribute('maxlength');
    persist();
    renderLive();
  }

  function onChange(e) {
    var t = e.target, kind = t.getAttribute('data-change'), uidv = t.getAttribute('data-uid');
    function item(c) { return c.items.filter(function (it) { return it.uid === uidv; })[0]; }
    if (t.hasAttribute('data-cbind') && t.type === 'checkbox') { state.customer[t.getAttribute('data-cbind')] = t.checked; return; }
    if (t.hasAttribute('data-cbind') && t.tagName === 'SELECT') { state.customer[t.getAttribute('data-cbind')] = t.value; return; }
    switch (kind) {
      case 'variant': commit(function (c) { var it = item(c); if (it) it.variant = t.value; }, { panel: false }); break;
      case 'logo': handleLogo(t.files && t.files[0]); t.value = ''; break;
      case 'hp-logo': commit(function (c) { c.hamper.useLogo = t.checked; }); break;
      case 'pp-on': commit(function (c) { var it = item(c); if (it) it.personal.on = t.checked; }); break;
      case 'pp-logo': commit(function (c) { var it = item(c); if (it) it.personal.logo = t.checked; }); break;
      case 'pp-place': commit(function (c) { var it = item(c); if (it) it.personal.placement = t.value; }, { panel: false }); break;
      case 'pp-font': commit(function (c) { var it = item(c); if (it) it.personal.font = t.value; }, { panel: false }); break;
      case 'hampers':
        var n = Math.floor(+t.value);
        if (!isFinite(n) || n < CAT.pricing.minHampers) { n = CAT.pricing.minHampers; toast('The minimum is ' + n + ' hamper.'); }
        if (n > CAT.pricing.maxHampersPerOrder) { toast('Orders above ' + CAT.pricing.maxHampersPerOrder + ' hampers need a call with our team.'); }
        commit(function (c) { c.hampers = n; });
        break;
      case 'order-status':
        getDb().then(function (db) {
          if (!db) return;
          return db.doc(t.getAttribute('data-path')).update({ status: t.value, statusUpdatedAt: new Date().toISOString() }).then(function () { toast('Status updated.'); });
        }).catch(function () { toast('Could not update the status. Try again.'); });
        break;
    }
  }

  function hideSampleNote() { var n = document.getElementById('kh-sample'); if (n) n.hidden = true; }

  /* ---------- start ---------- */
  function init() {
    var app = document.getElementById('customize');
    els = {
      app: app,
      header: app.querySelector('.kh-header'),
      steps: app.querySelector('#kh-steps'),
      stepCount: app.querySelector('#kh-stepcount'),
      controls: app.querySelector('.kh-controls'),
      stepTitle: app.querySelector('#kh-step-title'),
      panel: app.querySelector('#kh-panel'),
      stepNav: app.querySelector('#kh-stepnav'),
      stageWrap: app.querySelector('.kh-stage'),
      stage: app.querySelector('#kh-stage'),
      stageTitle: app.querySelector('#kh-stage-title'),
      stageTools: app.querySelector('#kh-stage-tools'),
      capacity: app.querySelector('#kh-capacity'),
      previewToggle: app.querySelector('#kh-preview-toggle'),
      summary: app.querySelector('#kh-summary'),
      mobileBar: app.querySelector('#kh-mobilebar'),
      toast: app.querySelector('#kh-toast'),
      modal: app.querySelector('#kh-modal'),
      inbox: app.querySelector('#kh-inbox')
    };

    var saved = load(CFG.storageKey);
    if (saved && saved.cfg) {
      state.cfg = P.normalize(saved.cfg, CAT).config;
      state.step = Math.max(0, Math.min(STEPS.length - 1, saved.step | 0));
      if (STEPS[state.step].id === 'order') state.step = stepIndex('review');
      state.visited = saved.visited || {};
      var lg = load(CFG.storageKey + '-logo');
      if (lg && lg.preview) state.logo = Object.assign({ original: lg.preview }, lg);
    } else {
      state.cfg = P.normalize(P.defaultConfig(CAT, { sample: true }), CAT).config;
    }
    if (!state.cfg.sample) hideSampleNote();

    // Deep link from the homepage, e.g. customize-hamper.html#add-steel-bottle:
    // add that product (if it is not already in) and open the Personalise step.
    var deep = /^#add-([a-z0-9-]+)$/.exec(location.hash || '');
    var deepNote = '';
    if (deep && P.findProduct(CAT, deep[1])) {
      var pid = deep[1];
      if (!state.cfg.items.some(function (it) { return it.productId === pid; })) {
        state.cfg.items.push(P.makeItem(CAT, pid));
        state.cfg = P.normalize(state.cfg, CAT).config;
        deepNote = P.findProduct(CAT, pid).name + ' added to your hamper.';
      } else deepNote = P.findProduct(CAT, pid).name + ' is already in your hamper.';
      state.step = P.findProduct(CAT, pid).personal ? stepIndex('personalise') : stepIndex('products');
      persist();
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandboxed frames may refuse */ }
    }

    preview = V.create(els.stage, { renderer: CFG.previewRenderer, catalogue: CAT, config: CFG });
    preview.onchange = function () { renderStage(); };
    var setKind = function (kind) { els.app.querySelector('#kh-renderer').textContent = kind === 'webgl' ? '3D preview' : 'Interactive preview'; renderStage(); };
    preview.onkind = setKind;
    preview.onlayout = function (info) {
      var tight = !!(info && info.overflow);
      if (tight !== state.layoutTight) { state.layoutTight = tight; renderCapacityNote(); }
    };
    setKind(preview.kind);

    app.addEventListener('click', onClick);
    app.addEventListener('input', onInput);
    app.addEventListener('change', onChange);
    app.addEventListener('submit', function (e) { if (e.target.id === 'kh-orderform') { e.preventDefault(); submitOrder(); } });

    renderAll();
    if (deepNote) toast(deepNote);
    initInbox();
    var resizeT;
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(renderStage, 150); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
