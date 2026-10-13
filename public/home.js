/*
 * KORE homepage controller.
 * - Maps the scroll position inside the story section to film progress (0..1)
 *   and hands it to the 3D scene; captions fade in and out on the same timeline.
 * - Falls back to a still-frame story when motion is reduced, WebGL is missing
 *   or the 3D library cannot load. The page never depends on the 3D view.
 */
(function () {
  'use strict';
  var CFG = Object.assign({ builderHref: 'customize-hamper.html', enquiryEndpoint: null, threeSources: [] }, window.KORE_SITE_CONFIG || {});
  var CAT = window.KoreCatalogue;
  var TL = window.KoreHomeScene ? window.KoreHomeScene.TIMELINE : null;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var phone = function () { return window.matchMedia('(max-width: 720px)').matches; };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var story = $('#story'), stage = $('#kr-stage'), sceneEl = $('#kr-scene'), poster = $('#kr-poster');
  var scene = null, mode = 'film', target = 0, shown = -1, raf = 0, lastT = 0;
  var perf = { n: 0, total: 0, level: 'high' };

  /* ---------- links into the hamper builder ---------- */
  document.body.classList.add('kr');
  var builderIsExternal = /^https?:/i.test(CFG.builderHref);
  $$('[data-builder]').forEach(function (a) {
    var add = a.getAttribute('data-add');
    a.href = CFG.builderHref + (add ? '#add-' + add : '');
    if (builderIsExternal) a.target = '_top';
  });

  /* ---------- real numbers from the catalogue ---------- */
  if (CAT) {
    var facts = { boxes: CAT.boxes.length, fillings: CAT.fillings.length, products: CAT.products.length, methods: Object.keys(CAT.methods).length, finishing: CAT.finishing.length };
    $$('[data-fact]').forEach(function (el) { el.textContent = facts[el.getAttribute('data-fact')]; });
  }

  /* ---------- navigation ---------- */
  var nav = $('#kr-nav'), menu = $('#kr-menu'), links = $('#kr-links');
  function closeMenu() { links.classList.remove('is-open'); nav.classList.remove('menu-open'); menu.setAttribute('aria-expanded', 'false'); }
  menu.addEventListener('click', function () {
    var open = !links.classList.contains('is-open');
    links.classList.toggle('is-open', open); nav.classList.toggle('menu-open', open);
    menu.setAttribute('aria-expanded', String(open));
    if (open) { var first = links.querySelector('a'); if (first) first.focus(); }
  });
  links.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && links.classList.contains('is-open')) { closeMenu(); menu.focus(); } });

  /* ---------- caption timing, derived from the film timeline ---------- */
  var WINDOWS = {};
  if (TL) {
    WINDOWS.hero = { a: -1, b: -1, c: 0.035, d: 0.07 };
    WINDOWS.cue = { a: -1, b: -1, c: 0.01, d: 0.03 };
    WINDOWS.reveal = { a: 0.33, b: 0.345, c: 0.38, d: 0.395 };
    TL.products.forEach(function (pr) { WINDOWS[pr.key] = { a: pr.rise[1] - 0.012, b: pr.rise[1] + 0.004, c: pr.back[0] - 0.012, d: pr.back[0] + 0.004 }; });
    WINDOWS.collection = { a: 0.925, b: 0.95, c: 2, d: 3 };
  }
  var JUMPS = { hero: 0, reveal: 0.362, bottle: 0.465, notebook: 0.605, mug: 0.74, pen: 0.85, collection: 0.975 };
  var caps = $$('[data-cap]', stage).map(function (el) { return { el: el, key: el.getAttribute('data-cap'), cls: el.className }; });
  var chapterBtns = $$('.kr-chapters button');

  function capOpacity(w, p) {
    if (!w) return 0;
    var i = w.a < 0 ? 1 : Math.min(1, Math.max(0, (p - w.a) / (w.b - w.a)));
    var o = w.c > 1 ? 1 : Math.min(1, Math.max(0, 1 - (p - w.c) / (w.d - w.c)));
    return Math.min(i, o);
  }
  function updateCaptions(p) {
    var mob = phone();
    caps.forEach(function (c) {
      var w = WINDOWS[c.key], o = capOpacity(w, p);
      var entering = w && w.a >= 0 && p < w.b;
      var dy = (1 - o) * (entering ? 18 : -18);
      c.el.style.opacity = o.toFixed(3);
      c.el.style.visibility = o < 0.02 ? 'hidden' : 'visible';
      var base = '';
      if (!mob) {
        if (/kr-cap-hero|kr-cap-center|kr-scroll-cue/.test(c.cls)) base = 'translateX(-50%) ';
        else if (/kr-cap-right/.test(c.cls)) base = 'translateY(-50%) ';
      } else if (/kr-cap-hero|kr-scroll-cue/.test(c.cls)) base = 'translateX(-50%) ';
      c.el.style.transform = base + 'translateY(' + dy.toFixed(1) + 'px)';
    });
    var current = 'hero', best = -1;
    Object.keys(JUMPS).forEach(function (k) { if (p >= JUMPS[k] - 0.06 && JUMPS[k] > best) { best = JUMPS[k]; current = k; } });
    chapterBtns.forEach(function (b) { if (b.getAttribute('data-jump') === current) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  }

  function storyProgress() {
    var r = story.getBoundingClientRect(), span = r.height - window.innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
  }

  function jumpTo(key) {
    if (mode !== 'film') {
      var frames = $$('.kr-frame');
      var idx = { hero: 0, reveal: 1, bottle: 2, notebook: 3, mug: 4, pen: 5, collection: 6 }[key] || 0;
      if (frames[idx]) frames[idx].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    var span = story.offsetHeight - window.innerHeight;
    var top = story.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + span * (JUMPS[key] || 0), behavior: reduce ? 'auto' : 'smooth' });
  }
  $$('[data-jump]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); jumpTo(el.getAttribute('data-jump')); });
  });

  /* ---------- the frame loop: runs only while progress is settling ---------- */
  function tick(now) {
    raf = 0;
    if (mode !== 'film') return;
    now = now || performance.now();
    var dt = lastT ? Math.min(1000, now - lastT) : 16;
    lastT = now;
    // time-based easing: smooth on fast screens, immediate on slow ones
    var diff = target - shown, k = 1 - Math.exp(-dt / 90);
    shown = Math.abs(diff) < 0.0006 || shown < 0 ? target : shown + diff * k;
    if (scene) {
      var t0 = performance.now();
      scene.setProgress(shown);
      measure(performance.now() - t0);
    }
    updateCaptions(shown);
    if (shown !== target) raf = requestAnimationFrame(tick); else lastT = 0;
  }
  // adapt to the device: drop to lighter rendering, then to still frames
  function measure(ms) {
    if (window.KORE_FORCE_FILM || ms < 1) return;
    perf.n++; perf.total += ms;
    if (perf.n < 6) return;
    var avg = perf.total / perf.n;
    perf.n = 0; perf.total = 0;
    if (perf.level === 'high' && avg > 45) { perf.level = 'low'; scene.setQuality('low'); }
    else if (perf.level === 'low' && avg > 160) goStatic('this device renders 3D too slowly');
  }
  function onScroll() {
    nav.classList.toggle('is-solid', window.scrollY > 24);
    if (mode !== 'film') return;
    target = storyProgress();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { if (scene) scene.resize(); onScroll(); });

  /* ---------- static story (reduced motion / no 3D) ---------- */
  function goStatic(reason) {
    if (mode === 'static') return;
    mode = 'static';
    if (window.console && reason) console.info('[KORE] Showing the still-frame story:', reason);
    story.classList.add('is-static');
    $('#kr-static').hidden = false;
    if (scene) { try { scene.destroy(); } catch (e) { /* ignore */ } scene = null; }
  }

  /* ---------- load the 3D film ---------- */
  function webgl() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = function () { res(); }; s.onerror = function () { s.remove(); rej(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadThree() {
    if (window.THREE) return Promise.resolve();
    var list = CFG.threeSources || [];
    function attempt(i) {
      if (i >= list.length) return Promise.reject(new Error('3D library unavailable'));
      return loadScript(list[i][0]).then(function () { return loadScript(list[i][1]).catch(function () { /* optional */ }); }).catch(function () { return attempt(i + 1); });
    }
    return Promise.race([attempt(0), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('3D library timed out')); }, 20000); })]);
  }
  function startFilm() {
    var loading = $('#kr-loading');
    var slow = setTimeout(function () { loading.hidden = false; }, 700);
    loadThree().then(function () {
      scene = window.KoreHomeScene.create(sceneEl, {
        catalogue: CAT,
        small: phone(),
        onBackground: function (bg) { stage.style.backgroundColor = bg; },
        onError: function (e) { goStatic(e.message); }
      });
      shown = -1; target = storyProgress();
      scene.setProgress(target); shown = target;
      updateCaptions(target);
      requestAnimationFrame(function () { sceneEl.classList.add('is-ready'); poster.style.opacity = '0'; clearTimeout(slow); loading.hidden = true; });
    }).catch(function (e) { clearTimeout(slow); loading.hidden = true; goStatic(e.message); });
  }

  if (!TL || reduce || !webgl()) {
    goStatic(reduce ? 'reduced motion' : 'WebGL unavailable');
  } else {
    updateCaptions(storyProgress());
    // let the poster paint first, then bring in the 3D library
    if (document.readyState === 'complete') requestAnimationFrame(startFilm);
    else window.addEventListener('load', function () { requestAnimationFrame(startFilm); });
  }
  onScroll();

  /* ---------- gentle reveals for the editorial chapters ---------- */
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('kr-motion');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach(function (el) { io.observe(el); });
    // occasion images drift slightly with the pointer
    $$('.kr-occ').forEach(function (card) {
      var img = card.querySelector('img');
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        img.style.setProperty('--px', (((e.clientX - r.left) / r.width - 0.5) * -10).toFixed(1) + 'px');
        img.style.setProperty('--py', (((e.clientY - r.top) / r.height - 0.5) * -10).toFixed(1) + 'px');
      });
      card.addEventListener('pointerleave', function () { img.style.setProperty('--px', '0px'); img.style.setProperty('--py', '0px'); });
    });
  }

  /* ---------- enquiry form ---------- */
  var form = $('#kr-enquiry-form'), status = $('#kr-form-status');
  var EMAIL_TO = CFG.enquiryEmail || 'koreexpression@gmail.com';
  function cap(name) {
    try { return window.claude && typeof window.claude.use === 'function' ? window.claude.use(name).catch(function () { return null; }) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
  }
  function fieldError(id, msg) {
    var input = $('#' + id), err = $('#' + id + '-err');
    if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', id + '-err'); err.textContent = msg; err.hidden = false; }
    else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); err.hidden = true; }
    return !msg;
  }
  /* The pre-filled email: what the visitor typed, ready to send. */
  function enquirySubject(d) {
    return 'Corporate gifting enquiry: ' + d.occasion + ', ' + d.quantity + ' (' + (d.company || d.name) + ')';
  }
  function enquiryBody(d, ref) {
    var lines = ['Hello KORE team,', '', 'I would like a free custom proposal for corporate gifting.', '',
      'Occasion: ' + d.occasion, 'Roughly how many recipients: ' + d.quantity, 'Name: ' + d.name,
      'Work email: ' + d.email, 'Company: ' + (d.company || 'Not given')];
    if (ref) lines.push('Enquiry reference: ' + ref);
    lines.push('', 'Thank you.');
    return lines.join('\n');
  }
  function gmailUrl(d, ref) {
    return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(EMAIL_TO) +
      '&su=' + encodeURIComponent(enquirySubject(d)) + '&body=' + encodeURIComponent(enquiryBody(d, ref));
  }
  function mailtoUrl(d, ref) {
    return 'mailto:' + EMAIL_TO + '?subject=' + encodeURIComponent(enquirySubject(d)) + '&body=' + encodeURIComponent(enquiryBody(d, ref));
  }
  function setStatus(text, cls, d, ref) {
    status.className = 'kr-form-status' + (cls ? ' ' + cls : '');
    status.textContent = text + ' ';
    if (!d) return;
    var g = document.createElement('a'); g.href = gmailUrl(d, ref); g.target = '_blank'; g.textContent = 'Open in Gmail';
    var m = document.createElement('a'); m.href = mailtoUrl(d, ref); m.textContent = 'Open in your email app';
    status.appendChild(g); status.appendChild(document.createTextNode(' · ')); status.appendChild(m);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {
      occasion: form.occasion.value, quantity: form.quantity.value,
      name: form.name.value.trim().slice(0, 80), email: form.email.value.trim().slice(0, 120), company: form.company.value.trim().slice(0, 100)
    };
    var ok = fieldError('f-name', data.name.length < 2 ? 'Enter your name.' : '');
    ok = fieldError('f-email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email) ? '' : 'Enter an email address like name@company.com.') && ok;
    status.className = 'kr-form-status';
    if (!ok) { status.textContent = 'Check the highlighted fields.'; status.classList.add('is-bad'); (form.querySelector('[aria-invalid="true"]') || form).focus(); return; }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    /* Open the pre-filled Gmail draft straight from the click, so the browser does not block it. */
    var opened = window.open(gmailUrl(data, ''), '_blank');
    setStatus('Saving your enquiry…', '', null);
    send(data).then(function (r) {
      setStatus(r.message, 'is-ok', data, r.ref);
      form.reset();
    }).catch(function (err) {
      if (err && err.code === 'no-backend') {
        setStatus('Your email is ready. Press Send in the Gmail tab to deliver your enquiry.' + (opened ? '' : ' Your browser blocked the new tab, so use a link below.'), 'is-ok', data, '');
      } else {
        setStatus('We could not save your enquiry online just now, but your email draft is ready.' + (opened ? '' : ' Your browser blocked the new tab.'), 'is-bad', data, '');
      }
    }).then(function () { btn.disabled = false; });
  });

  /* Resolves { message, ref } when the enquiry is stored; rejects when it is not. */
  function send(data) {
    if (CFG.enquiryEndpoint) {
      return fetch(CFG.enquiryEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.ok) {
            // The enquiry API is not deployed or not set up yet: the email draft is the enquiry.
            var err = new Error('save failed');
            if (j.code === 'not_configured' || r.status === 404 || r.status === 405) err.code = 'no-backend';
            throw err;
          }
          return { ref: j.reference, message: 'Thank you. Your enquiry ' + j.reference + ' is saved' + (j.emailStatus === 'sent' ? ', and we have emailed you a copy' : '') + '. We reply within 24 hours.' };
        }); });
    }
    return Promise.all([cap('db'), cap('user')]).then(function (c) {
      var db = c[0], user = c[1];
      if (!db || !user) { var nb = new Error('no database'); nb.code = 'no-backend'; throw nb; }
      return user.id().then(function (uid) {
        if (!uid) throw new Error('not signed in');
        var id = 'E' + Date.now().toString(36).toUpperCase();
        return db.doc('enquiries/' + uid + '/items/' + id).set(Object.assign({ reference: id, createdAt: new Date().toISOString(), status: 'new' }, data))
          .then(function () { return db.doc('enquiries/' + uid).set({ lastAt: new Date().toISOString() }).catch(function () {}); })
          .then(function () { return { ref: id, message: 'Thank you. Your enquiry ' + id + ' is saved. We reply within 24 hours.' }; });
      });
    });
  }

  /* ---------- enquiries inbox (editors of this page only) ---------- */
  if (!CFG.enquiryEndpoint) {
    cap('user').then(function (user) {
      if (!user || typeof user.canEdit !== 'function') return;
      return user.canEdit().then(function (can) {
        if (!can) return;
        var btn = $('#kr-inbox-btn'), box = $('#kr-inbox');
        btn.hidden = false;
        btn.addEventListener('click', function () {
          if (!box.hidden) { box.hidden = true; return; }
          box.hidden = false; box.textContent = 'Loading enquiries…';
          cap('db').then(function (db) {
            if (!db) throw new Error('The inbox is not available here.');
            return db.collection('enquiries').get().then(function (snap) {
              return Promise.all(snap.docs.map(function (d) { return db.collection('enquiries/' + d.id + '/items').get().then(function (s) { return s.docs.map(function (x) { return x.data(); }); }); }));
            });
          }).then(function (groups) {
            var rows = [].concat.apply([], groups).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
            var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
            box.innerHTML = '<h2 class="kr-mini">Enquiries</h2>' + (rows.length ? '<div class="kr-inbox-wrap"><table><thead><tr><th>Received</th><th>Name</th><th>Email</th><th>Company</th><th>Occasion</th><th>Recipients</th></tr></thead><tbody>' +
              rows.map(function (r) { return '<tr><td>' + esc((r.createdAt || '').replace('T', ' ').slice(0, 16)) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + esc(r.company) + '</td><td>' + esc(r.occasion) + '</td><td>' + esc(r.quantity) + '</td></tr>'; }).join('') + '</tbody></table></div>'
              : '<p>No enquiries yet. They appear here when someone sends the form above.</p>');
          }).catch(function (err) { box.textContent = err.message; });
        });
      });
    });
  }

  window.KoreHome = { progress: function () { return shown; }, mode: function () { return mode; }, jumpTo: jumpTo };
})();
