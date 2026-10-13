/*
 * KORE hamper preview: real-time 3D renderer (Three.js + WebGL).
 *
 * Registers renderer 'webgl' with KorePreview. It implements the same
 * interface as the CSS renderer (render, setView, zoomBy, toggleLid,
 * resetView, state, destroy), so the page, the pricing engine and the order
 * flow are unchanged: the configuration object stays the single source of truth.
 *
 * - Loads Three.js on demand (local vendor copy first, pinned CDN second).
 * - Builds everything procedurally when no model is supplied.
 * - Uses a catalogue entry's `model` (GLB/glTF) when present; each file is
 *   loaded once and cloned for every copy.
 * - Falls back to the CSS renderer if WebGL, the library or the GPU context
 *   is unavailable, so the page keeps working.
 *
 * Units: 1 scene unit = 1 cm.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.KorePreview) return;
  var KP = window.KorePreview;

  var DEFAULT_SOURCES = [
    { three: 'vendor/three/three.min.js', orbit: 'vendor/three/OrbitControls.js', gltf: 'vendor/three/GLTFLoader.js', room: 'vendor/three/RoomEnvironment.js' },
    { three: 'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js', orbit: 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js', gltf: 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js', room: 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/environments/RoomEnvironment.js' }
  ];

  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { s.remove(); reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  var threePromise = null;
  function loadThree(sources) {
    if (window.THREE && window.THREE.OrbitControls) return Promise.resolve(window.THREE);
    if (threePromise) return threePromise;
    function attempt(i) {
      if (i >= sources.length) return Promise.reject(new Error('The 3D library could not be loaded.'));
      var s = sources[i];
      var core = window.THREE ? Promise.resolve() : loadScript(s.three);
      return core.then(function () {
        return Promise.all([
          window.THREE.OrbitControls ? Promise.resolve() : loadScript(s.orbit),
          window.THREE.GLTFLoader ? Promise.resolve() : loadScript(s.gltf).catch(function () { /* optional */ }),
          window.THREE.RoomEnvironment ? Promise.resolve() : loadScript(s.room).catch(function () { /* optional */ })
        ]);
      }).then(function () {
        if (!window.THREE || !window.THREE.OrbitControls) throw new Error('incomplete');
        return window.THREE;
      }).catch(function () { return attempt(i + 1); });
    }
    threePromise = new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('The 3D library took too long to load.')); }, 20000);
      attempt(0).then(function (T) { clearTimeout(t); resolve(T); }, function (e) { clearTimeout(t); reject(e); });
    });
    threePromise.catch(function () { threePromise = null; });
    return threePromise;
  }

  /* ---------- helpers ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var VIEWS = {
    front: { az: -32, pol: 60, dist: 1 },
    side: { az: -90, pol: 66, dist: 1 },
    top: { az: 0, pol: 3, dist: 1.02 },
    inside: { az: -18, pol: 34, dist: 0.78 }
  };

  /* ---------- the renderer ---------- */
  function Hamper3D(el, opts) {
    this.el = el;
    this.opts = opts || {};
    this.kind = 'webgl';
    this.view = 'front';
    this.zoom = 1;
    this.lidClosed = false;
    this.last = null;
    this.ready = false;
    this.fallback = null;
    this.buildId = 0;
    this.matCache = new Map();
    this.keepMats = new Set();
    this.texCache = new Map();
    this.protoCache = new Map();
    this.modelCache = new Map();
    this.imgCache = new Map();
    this.fill = null;
    this.layout = { overflow: false };
    el.classList.add('k3-root');
    el.koreRenderer = this; // handy for debugging: element.koreRenderer.renderer.info
    el.innerHTML = '<div class="k3-loading" role="status"><span class="k3-spin" aria-hidden="true"></span><span>Loading 3D preview…</span></div>';
    var self = this;
    var sources = (this.opts.config && this.opts.config.threeSources) || DEFAULT_SOURCES;
    loadThree(sources).then(function () {
      try { self._init(); } catch (e) { self._fallback(e); }
    }, function (e) { self._fallback(e); });
  }

  var proto3 = Hamper3D.prototype;

  proto3._fallback = function (err) {
    if (this.fallback) return;
    if (window.console) console.warn('[KORE preview] Using the CSS preview instead of WebGL:', err && err.message ? err.message : err);
    this._teardown();
    this.el.classList.remove('k3-root');
    this.el.innerHTML = '';
    this.fallback = KP.create(this.el, { renderer: 'css', catalogue: this.opts.catalogue });
    this.fallback.onchange = this.onchange;
    if (this.view !== 'front' && KP.VIEWS[this.view]) this.fallback.setView(this.view);
    if (this.lidClosed) this.fallback.toggleLid();
    this.kind = 'css';
    if (this.last) this.fallback.render(this.last.cfg, this.last.cat, this.last.ctx);
    if (this.onkind) this.onkind('css', err && err.message);
  };

  proto3._init = function () {
    var T = window.THREE, self = this;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    var canvas = document.createElement('canvas');
    canvas.className = 'k3-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Interactive 3D hamper preview. Drag to rotate, scroll or pinch to zoom.');
    canvas.tabIndex = 0;
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('No WebGL context');
    this.small = Math.min(window.innerWidth, window.innerHeight) < 600;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.small ? 1.5 : 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();

    var scene = new T.Scene();
    this.scene = scene;
    if (T.RoomEnvironment) {
      this.pmrem = new T.PMREMGenerator(renderer);
      this.envTex = this.pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
      scene.environment = this.envTex;
    }
    scene.add(new T.HemisphereLight(0xfff4e6, 0x8c7b68, T.RoomEnvironment ? 0.35 : 0.9));
    var key = new T.DirectionalLight(0xffffff, T.RoomEnvironment ? 1.25 : 1.6);
    key.position.set(45, 90, 55);
    key.castShadow = true;
    key.shadow.mapSize.set(this.small ? 1024 : 2048, this.small ? 1024 : 2048);
    key.shadow.camera.near = 10; key.shadow.camera.far = 300;
    key.shadow.camera.left = -70; key.shadow.camera.right = 70; key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
    scene.add(key);
    var fillL = new T.DirectionalLight(0xffe9d6, 0.35);
    fillL.position.set(-60, 30, -25);
    scene.add(fillL);
    var ground = new T.Mesh(new T.PlaneGeometry(600, 600), new T.ShadowMaterial({ opacity: 0.2 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    this.ground = ground;

    var camera = new T.PerspectiveCamera(30, 1, 1, 3000);
    camera.position.set(-40, 50, 70);
    this.camera = camera;
    var controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = !reduceMotion;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.addEventListener('start', function () { self.anim = null; self.view = 'custom'; self.dirty = true; self._hideHint(); });
    controls.addEventListener('change', function () { self.dirty = true; });
    controls.addEventListener('end', function () { if (self.onchange) self.onchange(); });
    this.controls = controls;

    this.root = new T.Group();
    scene.add(this.root);

    this.el.innerHTML = '';
    this.el.appendChild(canvas);
    var hint = document.createElement('div');
    hint.className = 'k3-hint';
    hint.textContent = 'Drag to rotate · scroll to zoom';
    this.el.appendChild(hint);
    this.hint = hint;
    setTimeout(function () { self._hideHint(); }, 6000);
    this.canvas = canvas;

    this._onLost = function (e) { e.preventDefault(); self._fallback(new Error('The graphics context was lost.')); };
    canvas.addEventListener('webglcontextlost', this._onLost);
    this._onDbl = function (e) { self._inspect(e); };
    canvas.addEventListener('dblclick', this._onDbl);
    this._onKey = function (e) {
      var used = true, off;
      if (e.key === '+' || e.key === '=') self.zoomBy(1.15);
      else if (e.key === '-' || e.key === '_') self.zoomBy(1 / 1.15);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        off = self.camera.position.clone().sub(self.controls.target);
        off.applyAxisAngle(new T.Vector3(0, 1, 0), (e.key === 'ArrowLeft' ? -1 : 1) * 0.2);
        self.camera.position.copy(self.controls.target).add(off); self.view = 'custom';
      } else used = false;
      if (used) { e.preventDefault(); self.dirty = true; if (self.onchange) self.onchange(); }
    };
    canvas.addEventListener('keydown', this._onKey);

    this._resize();
    if (window.ResizeObserver) { this.ro = new ResizeObserver(function () { self._resize(); }); this.ro.observe(this.el); }
    if (window.IntersectionObserver) { this.io = new IntersectionObserver(function (en) { self.visible = en[0].isIntersecting; }); this.io.observe(this.el); }
    this.visible = true;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self._clearLabelCache(); self._rebuild(); });

    this.ready = true;
    if (this.last) this._build(this.last.cfg, this.last.cat, this.last.ctx);
    this.setView(this.view === 'custom' ? 'front' : this.view, true);
    var loop = function () {
      self.raf = requestAnimationFrame(loop);
      if (document.hidden || !self.visible) return;
      var moved = self.controls.update();
      if (self._tick()) moved = true;
      if (moved || self.dirty) { self.renderer.render(self.scene, self.camera); self.dirty = false; }
    };
    loop();
    if (this.onkind) this.onkind('webgl');
  };

  proto3._hideHint = function () { if (this.hint) this.hint.classList.add('is-hidden'); };

  proto3._resize = function () {
    if (!this.renderer) return;
    var w = this.el.clientWidth || 400, h = this.el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  };

  /* camera animation and lid animation */
  proto3._tick = function () {
    var now = performance.now(), active = false;
    if (this.anim) {
      var a = this.anim, t = clamp((now - a.t0) / a.dur, 0, 1), k = ease(t);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      if (t >= 1) this.anim = null;
      active = true;
    }
    if (this.lidAnim && this.lid) {
      var l = this.lidAnim, tl = clamp((now - l.t0) / l.dur, 0, 1), kl = ease(tl);
      this.lid.position.lerpVectors(l.fromPos, l.toPos, kl);
      this.lid.quaternion.copy(l.fromQ).slerp(l.toQ, kl);
      if (tl >= 1) this.lidAnim = null;
      active = true;
    }
    return active;
  };

  proto3._frame = function () {
    var g = this.geom || { W: 32, D: 32, H: 12, lidUp: 30 };
    // vertical extent: tall products stick out ~2x the box height; an open lid stands about D tall behind it
    var up = Math.max(g.H * 2.1, g.lidUp || 0);
    var depth = g.D + (g.lidUp ? g.D * 0.35 : 0);
    var r = Math.sqrt(g.W * g.W + depth * depth + up * up) / 2;
    var fov = this.camera.fov * Math.PI / 180;
    var aspect = Math.max(0.6, this.camera.aspect);
    var dist = (r / Math.sin(fov / 2)) * (aspect < 1 ? 1.1 / aspect : 0.9);
    return { target: new window.THREE.Vector3(0, up * 0.42, g.lidUp ? -g.D * 0.18 : 0), dist: dist };
  };

  proto3._applyLimits = function () {
    var f = this._frame();
    this.controls.minDistance = f.dist * 0.35;
    this.controls.maxDistance = f.dist * 1.8;
  };

  proto3._cameraFor = function (name) {
    var T = window.THREE, v = VIEWS[name] || VIEWS.front, f = this._frame();
    var d = f.dist * v.dist / this.zoom;
    var az = v.az * Math.PI / 180, pol = v.pol * Math.PI / 180;
    var pos = new T.Vector3(d * Math.sin(pol) * Math.sin(az), d * Math.cos(pol), d * Math.sin(pol) * Math.cos(az)).add(f.target);
    return { pos: pos, target: f.target };
  };

  proto3._animateTo = function (pos, target, instant) {
    if (instant || reduceMotion) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.anim = null; this.dirty = true; return;
    }
    this.anim = { fromPos: this.camera.position.clone(), toPos: pos.clone(), fromTarget: this.controls.target.clone(), toTarget: target.clone(), t0: performance.now(), dur: 700 };
  };

  /* ---------- public interface ---------- */
  proto3.setView = function (name, instant) {
    if (this.fallback) return this.fallback.setView(name);
    if (!VIEWS[name]) return;
    var prev = this.view;
    this.view = name;
    if (!this.ready) return;
    var c = this._cameraFor(name);
    this._animateTo(c.pos, c.target, instant);
    if ((prev === 'top' || prev === 'inside') !== (name === 'top' || name === 'inside')) this._rebuild();
  };
  proto3.zoomBy = function (f) {
    if (this.fallback) return this.fallback.zoomBy(f);
    this.zoom = clamp(this.zoom * f, 0.55, 2.6);
    if (!this.ready) return;
    var off = this.camera.position.clone().sub(this.controls.target);
    var len = clamp(off.length() / f, this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this._animateTo(this.controls.target.clone().add(off), this.controls.target.clone(), false);
  };
  proto3.resetView = function () {
    if (this.fallback) return this.fallback.resetView();
    this.zoom = 1;
    var prev = this.view;
    this.view = 'front';
    if (!this.ready) return;
    var c = this._cameraFor('front');
    this._animateTo(c.pos, c.target, false);
    if (prev === 'top' || prev === 'inside') this._rebuild();
  };
  proto3.toggleLid = function () {
    if (this.fallback) return this.fallback.toggleLid();
    this.lidClosed = !this.lidClosed;
    this._rebuild();
    return this.lidClosed;
  };
  proto3.state = function () {
    if (this.fallback) return this.fallback.state();
    return { view: this.view, zoom: this.zoom, lidClosed: this.lidClosed };
  };
  proto3.render = function (cfg, cat, ctx) {
    this.last = { cfg: JSON.parse(JSON.stringify(cfg)), cat: cat, ctx: ctx || {} };
    if (this.fallback) return this.fallback.render(cfg, cat, ctx);
    if (!this.ready) return;
    var self = this;
    // coalesce bursts (typing) into one rebuild per frame
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(function () { self._pending = false; if (!self.fallback && self.last) self._build(self.last.cfg, self.last.cat, self.last.ctx); });
  };
  proto3._rebuild = function () { if (this.last && this.ready && !this.fallback) this._build(this.last.cfg, this.last.cat, this.last.ctx); };
  proto3.destroy = function () {
    if (this.fallback) { this.fallback.destroy(); this.fallback = null; }
    this._teardown();
    this.el.innerHTML = '';
  };

  proto3._teardown = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this._onLost);
      this.canvas.removeEventListener('dblclick', this._onDbl);
      this.canvas.removeEventListener('keydown', this._onKey);
    }
    if (this.controls) this.controls.dispose();
    if (this.root) this._disposeBuild();
    var disposeAll = function (map, fn) { map.forEach(function (v) { try { fn(v); } catch (e) { /* ignore */ } }); map.clear(); };
    disposeAll(this.matCache, function (v) { v.mat.dispose(); });
    disposeAll(this.texCache, function (v) { v.tex.dispose(); });
    disposeAll(this.protoCache, function (v) { v.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); });
    if (this.fill) { this._disposeObject(this.fill.group, true); this.fill = null; }
    if (this.envTex) this.envTex.dispose();
    if (this.pmrem) this.pmrem.dispose();
    if (this.renderer) { this.renderer.dispose(); if (this.renderer.forceContextLoss) try { this.renderer.forceContextLoss(); } catch (e) { /* ignore */ } }
    this.renderer = null; this.ready = false;
  };

  /* ---------- resources (cached and reused) ---------- */
  proto3._tex = function (kind) {
    var keyName = 'pattern:' + kind, hit = this.texCache.get(keyName);
    if (hit) { hit.used = this.buildId; hit.keep = true; return hit.tex; }
    var T = window.THREE, c = document.createElement('canvas'), s = 256, g;
    c.width = c.height = s; g = c.getContext('2d');
    var r = rng(hash(kind));
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, s, s);
    var i;
    if (kind === 'wood') {
      for (i = 0; i < 70; i++) { g.strokeStyle = 'rgba(90,60,30,' + (0.06 + r() * 0.14) + ')'; g.lineWidth = 1 + r() * 3; g.beginPath(); var y = r() * s; g.moveTo(0, y); for (var x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i) * 3); g.stroke(); }
    } else if (kind === 'weave') {
      for (var yy = 0; yy < s; yy += 16) for (var xx = 0; xx < s; xx += 16) {
        var odd = ((xx + yy) / 16) % 2;
        g.fillStyle = odd ? 'rgba(80,60,30,0.32)' : 'rgba(255,255,255,0.25)';
        g.fillRect(xx, yy, 16, 16);
        g.strokeStyle = 'rgba(60,40,20,0.35)'; g.lineWidth = 1.2;
        for (var k2 = 3; k2 < 16; k2 += 4) { g.beginPath(); if (odd) { g.moveTo(xx + k2, yy); g.lineTo(xx + k2, yy + 16); } else { g.moveTo(xx, yy + k2); g.lineTo(xx + 16, yy + k2); } g.stroke(); }
      }
    } else if (kind === 'canvas' || kind === 'linen' || kind === 'cloth') {
      var step = kind === 'linen' ? 2 : 3;
      for (i = 0; i < s; i += step) { g.fillStyle = 'rgba(0,0,0,' + (0.03 + r() * 0.05) + ')'; g.fillRect(0, i, s, 1); g.fillRect(i, 0, 1, s); }
    } else if (kind === 'kraft') {
      for (i = 0; i < 1800; i++) { g.fillStyle = 'rgba(70,45,20,' + (0.05 + r() * 0.15) + ')'; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
    } else if (kind === 'wrap') {
      g.fillStyle = '#EDE3CF'; g.fillRect(0, 0, s, s);
      for (i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#A8562E' : '#C4A15A'; g.beginPath(); g.arc((i % 4) * 64 + (Math.floor(i / 4) % 2) * 32 + 16, Math.floor(i / 4) * 64 + 16, 5, 0, Math.PI * 2); g.fill(); }
    } else if (kind === 'honeycomb') {
      g.strokeStyle = 'rgba(70,50,30,0.45)'; g.lineWidth = 2;
      for (var hy = 0; hy < s + 20; hy += 18) for (var hx = 0; hx < s + 20; hx += 21) { var ox = (Math.round(hy / 18) % 2) * 10.5; g.beginPath(); for (var a = 0; a < 6; a++) { var ang = Math.PI / 3 * a + Math.PI / 6; g.lineTo(hx + ox + Math.cos(ang) * 10, hy + Math.sin(ang) * 10); } g.closePath(); g.stroke(); }
    } else if (kind === 'leather') {
      for (i = 0; i < 3000; i++) { g.fillStyle = 'rgba(0,0,0,' + r() * 0.06 + ')'; g.beginPath(); g.arc(r() * s, r() * s, r() * 1.6, 0, 7); g.fill(); }
    }
    var tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.encoding = T.sRGBEncoding;
    tex.anisotropy = Math.min(8, this.maxAniso);
    var rep = { wood: [1.5, 1.5], weave: [3, 3], canvas: [4, 4], linen: [5, 5], cloth: [3, 3], kraft: [2, 2], wrap: [3, 3], honeycomb: [3, 3], leather: [2, 2] }[kind] || [2, 2];
    tex.repeat.set(rep[0], rep[1]);
    this.texCache.set(keyName, { tex: tex, used: this.buildId, keep: true });
    return tex;
  };

  /* material by finish + colour; cached and shared */
  proto3._mat = function (finish, hex, extra) {
    var keyName = finish + '|' + hex + '|' + (extra || '');
    var hit = this.matCache.get(keyName);
    if (hit) { hit.used = this.buildId; return hit.mat; }
    var T = window.THREE, m;
    var col = new T.Color(hex || '#cccccc');
    switch (finish) {
      case 'paper': m = new T.MeshStandardMaterial({ color: col, roughness: 0.78, metalness: 0 }); break;
      case 'edge': m = new T.MeshStandardMaterial({ color: col.clone().offsetHSL(0, -0.05, 0.08), roughness: 0.85 }); break;
      case 'linen': m = new T.MeshStandardMaterial({ color: col, roughness: 0.9, map: this._tex('linen') }); break;
      case 'wood': m = new T.MeshStandardMaterial({ color: col, roughness: 0.68, map: this._tex('wood') }); break;
      case 'weave': m = new T.MeshStandardMaterial({ color: col, roughness: 0.95, map: this._tex('weave'), bumpMap: this._tex('weave'), bumpScale: 0.6 }); break;
      case 'canvas': m = new T.MeshStandardMaterial({ color: col, roughness: 0.95, map: this._tex('canvas') }); break;
      case 'kraft': m = new T.MeshStandardMaterial({ color: col, roughness: 0.88, map: this._tex('kraft') }); break;
      case 'wrap': m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, map: this._tex('wrap') }); break;
      case 'suede': m = new T.MeshStandardMaterial({ color: col, roughness: 1 }); break;
      case 'satin': m = new T.MeshPhysicalMaterial({ color: col, roughness: 0.28, metalness: 0.08, clearcoat: 0.3, sheen: 0.6, sheenColor: col.clone().offsetHSL(0, 0, 0.2) }); break;
      case 'fabric': m = new T.MeshStandardMaterial({ color: col, roughness: 0.92, map: this._tex('cloth') }); break;
      case 'leather': m = new T.MeshStandardMaterial({ color: col, roughness: 0.55, map: this._tex('leather') }); break;
      case 'cloth': m = new T.MeshStandardMaterial({ color: col, roughness: 0.82, map: this._tex('cloth') }); break;
      case 'metal': m = new T.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.85 }); break;
      case 'powder': m = new T.MeshStandardMaterial({ color: col, roughness: 0.48, metalness: 0.25 }); break;
      case 'ceramic': m = new T.MeshPhysicalMaterial({ color: col, roughness: 0.22, metalness: 0, clearcoat: 0.6 }); break;
      case 'plastic': m = new T.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0 }); break;
      case 'glass': m = new T.MeshPhysicalMaterial({ color: col, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, clearcoat: 1, depthWrite: false }); break;
      case 'ribbon': m = new T.MeshPhysicalMaterial({ color: col, roughness: 0.32, metalness: 0.05, sheen: 0.8, sheenColor: col.clone().offsetHSL(0, 0, 0.25) }); break;
      case 'grosgrain': m = new T.MeshStandardMaterial({ color: col, roughness: 0.75, map: this._tex('canvas') }); break;
      case 'wax': m = new T.MeshPhysicalMaterial({ color: col, roughness: 0.35, clearcoat: 0.5 }); break;
      case 'clearwrap': m = new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.16, clearcoat: 1, side: T.DoubleSide, depthWrite: false }); break;
      case 'shadow': m = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }); break;
      default: m = new T.MeshStandardMaterial({ color: col, roughness: 0.6 });
    }
    if (extra === 'double') m.side = T.DoubleSide;
    if (extra === 'back') m.side = T.BackSide;
    this.matCache.set(keyName, { mat: m, used: this.buildId });
    return m;
  };

  /* text label rendered to a canvas texture; cached by content */
  proto3._label = function (spec) {
    var keyName = 'label:' + JSON.stringify(spec);
    var hit = this.texCache.get(keyName);
    if (hit) { hit.used = this.buildId; return hit; }
    var T = window.THREE, self = this;
    var lines = spec.lines.filter(Boolean);
    var W = 1024, H = Math.round(1024 / (spec.aspect || 2));
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    if (spec.bg) { g.fillStyle = spec.bg; g.fillRect(0, 0, W, H); }
    var logoH = 0, img = null;
    if (spec.logo) {
      img = spec.logo === '__ph__' ? null : this._image(spec.logo);
      if (img && img.complete && img.naturalWidth) logoH = H * (lines.length ? 0.36 : 0.7);
    }
    var big = lines.length ? Math.min(H * (logoH ? 0.26 : 0.36), (W * 0.86) / Math.max(4, lines[0].length * 0.52)) : 0;
    var small = big * 0.5;
    var total = logoH + (lines.length ? big + (lines.length - 1) * small * 1.35 : 0) + (logoH && lines.length ? H * 0.05 : 0);
    var y = (H - total) / 2;
    if (logoH) {
      var iw = img.naturalWidth * (logoH / img.naturalHeight), maxW = W * 0.6;
      if (iw > maxW) { logoH *= maxW / iw; iw = maxW; }
      g.drawImage(img, (W - iw) / 2, y, iw, logoH);
      y += logoH + H * 0.05;
    } else if (spec.logo) {
      g.strokeStyle = spec.colour; g.lineWidth = 4; g.setLineDash([12, 8]);
      var pw = W * 0.3, ph = H * 0.22; g.strokeRect((W - pw) / 2, y, pw, ph);
      g.setLineDash([]); g.fillStyle = spec.colour; g.font = '700 ' + Math.round(ph * 0.45) + 'px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('LOGO', W / 2, y + ph / 2);
      y += ph + H * 0.05;
    }
    g.fillStyle = spec.colour; g.textAlign = 'center'; g.textBaseline = 'top';
    if (spec.engrave) { g.shadowColor = 'rgba(255,255,255,0.35)'; g.shadowOffsetY = 2; }
    lines.forEach(function (t, i) {
      var size = i === 0 ? big : small;
      g.font = (i === 0 ? '600 ' : '600 ') + Math.round(size) + 'px ' + spec.font;
      var text = i === 0 ? t : t.toUpperCase();
      while (g.measureText(text).width > W * 0.92 && size > 10) { size *= 0.92; g.font = '600 ' + Math.round(size) + 'px ' + spec.font; }
      g.fillText(text, W / 2, y);
      y += size * 1.35;
    });
    var tex = new T.CanvasTexture(c);
    tex.encoding = T.sRGBEncoding;
    tex.anisotropy = Math.min(8, this.maxAniso);
    var rec = { tex: tex, used: this.buildId, aspect: W / H };
    this.texCache.set(keyName, rec);
    if (img && !(img.complete && img.naturalWidth)) img.addEventListener('load', function () { self.texCache.delete(keyName); tex.dispose(); self._rebuild(); }, { once: true });
    return rec;
  };

  proto3._image = function (src) {
    if (!src) return null;
    var img = this.imgCache.get(src);
    if (!img) { img = new Image(); img.src = src; this.imgCache.set(src, img); }
    return img;
  };

  proto3._clearLabelCache = function () {
    var self = this;
    this.texCache.forEach(function (v, k) { if (k.indexOf('label:') === 0) { v.tex.dispose(); self.texCache.delete(k); } });
  };

  /* ---------- geometry helpers ---------- */
  proto3._g = function (geo) { this.disposables.push(geo); return geo; };
  proto3._mesh = function (geo, mat, opts) {
    var m = new window.THREE.Mesh(geo, mat);
    m.castShadow = !(opts && opts.noCast);
    m.receiveShadow = true;
    return m;
  };
  proto3._labelPlane = function (rec, w, h) {
    var T = window.THREE;
    var mat = new T.MeshStandardMaterial({ map: rec.tex, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.disposables.push(mat);
    var m = new T.Mesh(this._g(new T.PlaneGeometry(w, h)), mat);
    m.renderOrder = 2;
    return m;
  };

  /* ---------- products ---------- */
  function finishFor(icon, colourId) {
    var metalCols = { steel: 1, silver: 1, gold: 1 };
    switch (icon) {
      case 'bottle': case 'flask': case 'tumbler': case 'travelmug': return metalCols[colourId] ? 'metal' : 'powder';
      case 'mug': return 'ceramic';
      case 'notebook': case 'planner': case 'folder': case 'kit': case 'sticky': case 'card': return 'cloth';
      case 'journal': case 'keychain': return 'leather';
      case 'pen': case 'penset': case 'usb': return metalCols[colourId] ? 'metal' : 'powder';
      case 'tote': case 'tshirt': case 'cap': case 'carekit': return 'fabric';
      case 'coaster': case 'diya': case 'bookmark': return 'metal';
      case 'organiser': case 'keepsake': case 'frame': return colourId === 'white' || colourId === 'black' ? 'plastic' : 'wood';
      case 'chocobox': case 'teatin': return 'paper';
      case 'coffeebag': case 'pouch': return colourId === 'kraft' ? 'kraft' : 'paper';
      default: return 'plastic';
    }
  }

  /* Builds one product at its real size (dims in cm). Parts tagged
   * userData.part = 'body' take the product colour. Returns
   * { group, label: { pos, w, h, rotY, rotX } } in the product's local space. */
  proto3._productProto = function (p) {
    var hit = this.protoCache.get(p.id);
    if (hit) return hit;
    var T = window.THREE, G = new T.Group(), self = this;
    var w = p.dims[0], h = p.dims[1];
    var BODY = new T.MeshStandardMaterial({ color: 0xcccccc }); BODY.userData.placeholder = 'body';
    function add(geo, part, x, y, z, opts) {
      var mat = part === 'body' ? BODY : self._mat(opts && opts.finish || 'plastic', opts && opts.hex || '#cccccc');
      var m = new T.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (opts && opts.rx) m.rotation.x = opts.rx;
      if (opts && opts.rz) m.rotation.z = opts.rz;
      if (opts && opts.ry) m.rotation.y = opts.ry;
      m.castShadow = true; m.receiveShadow = true;
      m.userData.part = part;
      G.add(m);
      return m;
    }
    var label = null, r;
    switch (p.icon) {
      case 'bottle':
        r = w / 2;
        add(new T.CylinderGeometry(r, r, h * 0.78, 40), 'body', 0, h * 0.39);
        add(new T.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'body', 0, h * 0.78);
        add(new T.CylinderGeometry(r * 0.55, r * 0.55, h * 0.12, 32), 'cap', 0, h * 0.92, 0, { finish: 'plastic', hex: '#2a2622' });
        label = { pos: [0, h * 0.45, r + 0.02], w: w * 1.1, h: h * 0.22 }; break;
      case 'flask':
        r = w / 2;
        add(new T.CylinderGeometry(r, r, h * 0.8, 40), 'body', 0, h * 0.4);
        add(new T.CylinderGeometry(r * 1.04, r * 1.04, h * 0.2, 40), 'cap', 0, h * 0.9, 0, { finish: 'metal', hex: '#9aa0a5' });
        label = { pos: [0, h * 0.42, r + 0.02], w: w * 1.1, h: h * 0.22 }; break;
      case 'mug':
        r = h * 0.42;
        add(new T.CylinderGeometry(r, r * 0.95, h, 40, 1, true), 'body', 0, h / 2, 0, {});
        G.children[G.children.length - 1].material = BODY;
        add(new T.CylinderGeometry(r * 0.94, r * 0.94, h * 0.02, 40), 'inside', 0, h * 0.86, 0, { finish: 'ceramic', hex: '#3b2a20' });
        add(new T.CircleGeometry(r * 0.95, 40), 'body', 0, 0.01, 0, { rx: -Math.PI / 2 });
        add(new T.TorusGeometry(h * 0.22, h * 0.05, 12, 24, Math.PI), 'body', r, h * 0.5, 0, { rz: -Math.PI / 2 });
        label = { pos: [0, h * 0.5, r + 0.05], w: r * 1.4, h: h * 0.4 }; break;
      case 'travelmug':
        add(new T.CylinderGeometry(w * 0.5, w * 0.4, h * 0.82, 40), 'body', 0, h * 0.41);
        add(new T.CylinderGeometry(w * 0.52, w * 0.52, h * 0.18, 40), 'lid', 0, h * 0.91, 0, { finish: 'plastic', hex: '#2a2622' });
        label = { pos: [0, h * 0.45, w * 0.46], w: w * 0.9, h: h * 0.25 }; break;
      case 'tumbler':
        add(new T.CylinderGeometry(w * 0.5, w * 0.38, h * 0.9, 40), 'body', 0, h * 0.45);
        add(new T.CylinderGeometry(w * 0.52, w * 0.52, h * 0.1, 40), 'lid', 0, h * 0.95, 0, { finish: 'plastic', hex: '#e8e4dc' });
        label = { pos: [0, h * 0.45, w * 0.45], w: w * 0.9, h: h * 0.25 }; break;
      case 'notebook': case 'journal': case 'planner': case 'folder': case 'kit':
        var th = p.icon === 'folder' || p.icon === 'kit' ? 2.2 : 1.8;
        add(new T.BoxGeometry(w, h, th), 'body', 0, h / 2);
        add(new T.BoxGeometry(w * 0.97, h * 0.97, th * 0.8), 'pages', 0.25, h / 2, 0, { finish: 'paper', hex: '#f4efe4' });
        add(new T.BoxGeometry(w * 0.08, h, th * 1.02), 'spine', -w * 0.46, h / 2, 0, { finish: 'leather', hex: '#2a2622' });
        if (p.icon === 'journal') add(new T.BoxGeometry(0.4, h * 1.002, th * 1.04), 'band', w * 0.36, h / 2, 0, { finish: 'plastic', hex: '#1d1a17' });
        label = { pos: [0.4, h * 0.55, th / 2 + 0.03], w: w * 0.75, h: h * 0.3 }; break;
      case 'pen':
        add(new T.CylinderGeometry(w / 2, w / 2, h * 0.86, 20), 'body', 0, h * 0.43);
        add(new T.ConeGeometry(w / 2, h * 0.14, 20), 'tip', 0, h * 0.93, 0, { finish: 'metal', hex: '#b9bcbe', rx: 0 });
        add(new T.BoxGeometry(w * 0.3, h * 0.3, w * 0.25), 'clip', 0, h * 0.7, w * 0.55, { finish: 'metal', hex: '#c4a15a' });
        label = { pos: [0, h * 0.4, w / 2 + 0.02], w: w * 0.95, h: h * 0.3, rotZ: Math.PI / 2 }; break;
      case 'penset':
        add(new T.BoxGeometry(w, h, 2.4), 'body', 0, h / 2);
        label = { pos: [0, h * 0.5, 1.23], w: w * 0.8, h: h * 0.25, rotZ: Math.PI / 2 }; break;
      case 'organiser':
        add(new T.BoxGeometry(w, h, 9), 'body', 0, h / 2);
        add(new T.CylinderGeometry(0.5, 0.5, h * 0.9, 12), 'pen', -w * 0.3, h + h * 0.2, 0, { finish: 'powder', hex: '#26221f' });
        add(new T.CylinderGeometry(0.5, 0.5, h * 0.8, 12), 'pen', -w * 0.22, h + h * 0.15, 1, { finish: 'powder', hex: '#a8562e' });
        label = { pos: [0, h * 0.5, 4.52], w: w * 0.7, h: h * 0.4 }; break;
      case 'sticky':
        for (var si2 = 0; si2 < 3; si2++) add(new T.BoxGeometry(w, w, 0.8), 'body', si2 * 0.6 - 0.6, w / 2 + si2 * 0.3, si2 * 0.8 - 0.8);
        label = { pos: [0.6, w * 0.55, 1.22], w: w * 0.7, h: w * 0.4 }; break;
      case 'tote':
        add(new T.BoxGeometry(w, h, 2.5), 'body', 0, h / 2);
        add(new T.TorusGeometry(w * 0.22, 0.35, 8, 24, Math.PI), 'body', 0, h, 0);
        label = { pos: [0, h * 0.5, 1.27], w: w * 0.7, h: h * 0.45 }; break;
      case 'keychain':
        add(new T.TorusGeometry(1.4, 0.22, 10, 28), 'ring', 0, h - 1.4, 0, { finish: 'metal', hex: '#c4a15a' });
        add(new T.BoxGeometry(w, h * 0.68, 0.5), 'body', 0, h * 0.36);
        label = { pos: [0, h * 0.36, 0.27], w: w * 0.85, h: h * 0.3 }; break;
      case 'bookmark':
        add(new T.BoxGeometry(w, h, 0.12), 'body', 0, h / 2);
        add(new T.CylinderGeometry(0.15, 0.4, 3, 8), 'tassel', 0, h + 1.5, 0, { finish: 'fabric', hex: '#a8562e' });
        label = { pos: [0, h * 0.5, 0.08], w: w * 0.8, h: h * 0.4, rotZ: Math.PI / 2 }; break;
      case 'tshirt':
        add(new T.BoxGeometry(w, 3, h), 'body', 0, 1.5);
        add(new T.CylinderGeometry(2.2, 2.2, 3.05, 24, 1, false, 0, Math.PI), 'collar', 0, 1.5, -h * 0.42, { finish: 'fabric', hex: '#d8d2c6' });
        label = { pos: [0, 3.03, 0], w: w * 0.5, h: h * 0.4, rotX: -Math.PI / 2 }; break;
      case 'cap':
        add(new T.SphereGeometry(w * 0.32, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'body', 0, 0);
        add(new T.CylinderGeometry(w * 0.3, w * 0.3, 0.3, 32, 1, false, -Math.PI / 2, Math.PI), 'body', 0, 0.15, w * 0.15);
        label = { pos: [0, w * 0.16, w * 0.29], w: w * 0.3, h: w * 0.15, rotX: -0.5 }; break;
      case 'chocobox':
        add(new T.BoxGeometry(w, h, 4), 'box', 0, h / 2, 0, { finish: 'paper', hex: '#3b2418' });
        add(new T.BoxGeometry(w * 0.36, h * 1.01, 4.06), 'body', 0, h * 0.5);
        label = { pos: [0, h * 0.5, 2.06], w: w * 0.34, h: h * 0.5 }; break;
      case 'cookiejar':
        r = w / 2;
        add(new T.CylinderGeometry(r, r, h * 0.85, 32), 'glass', 0, h * 0.425, 0, { finish: 'glass', hex: '#ffffff' });
        for (var ck = 0; ck < 5; ck++) add(new T.CylinderGeometry(r * 0.7, r * 0.7, 1, 20), 'cookie', 0, 1 + ck * 1.6, 0, { finish: 'paper', hex: ck % 2 ? '#c98f4e' : '#d9a35f', rx: (ck % 2 ? 0.2 : -0.2) });
        add(new T.CylinderGeometry(r * 0.85, r * 0.85, h * 0.15, 32), 'cork', 0, h * 0.92, 0, { finish: 'kraft', hex: '#c49a6c' });
        label = { pos: [0, h * 0.97, 0], w: r * 1.4, h: r * 1.4, rotX: -Math.PI / 2 }; break;
      case 'pouch': case 'coffeebag':
        add(new T.BoxGeometry(w, h, 4, 1, 1, 1), 'body', 0, h / 2);
        add(new T.BoxGeometry(w * 1.01, h * 0.1, 1.2), 'seal', 0, h * 0.97, 0, { finish: 'paper', hex: '#8a7552' });
        label = { pos: [0, h * 0.45, 2.02], w: w * 0.75, h: h * 0.35, bg: true }; break;
      case 'teatin':
        r = w / 2;
        add(new T.CylinderGeometry(r, r, h * 0.82, 36), 'body', 0, h * 0.41);
        add(new T.CylinderGeometry(r * 1.03, r * 1.03, h * 0.2, 36), 'lid', 0, h * 0.9, 0, { finish: 'metal', hex: '#c4a15a' });
        label = { pos: [0, h * 0.4, r + 0.03], w: w * 0.8, h: h * 0.3, bg: true }; break;
      case 'tube':
        add(new T.CylinderGeometry(w / 2, w * 0.3, h * 0.85, 28), 'tubebody', 0, h * 0.5, 0, { finish: 'plastic', hex: '#f4eee4' });
        add(new T.CylinderGeometry(w * 0.32, w * 0.32, h * 0.12, 24), 'cap', 0, h * 0.06, 0, { finish: 'plastic', hex: '#a8562e' });
        add(new T.BoxGeometry(w * 1.1, h * 0.04, 0.4), 'crimp', 0, h * 0.94, 0, { finish: 'plastic', hex: '#d8cdbd' });
        break;
      case 'jar':
        add(new T.CylinderGeometry(w / 2, w / 2, h * 0.75, 32), 'jarbody', 0, h * 0.375, 0, { finish: 'ceramic', hex: '#f1ece4' });
        add(new T.CylinderGeometry(w * 0.48, w * 0.48, h * 0.25, 32), 'lid', 0, h * 0.875, 0, { finish: 'metal', hex: '#c4a15a' });
        break;
      case 'carekit':
        add(new T.CapsuleGeometry ? new T.CapsuleGeometry(h * 0.35, w - h * 0.7, 8, 16) : new T.BoxGeometry(w, h * 0.7, 6), 'body', 0, h * 0.35, 0, { rz: T.CapsuleGeometry ? Math.PI / 2 : 0 });
        if (T.CapsuleGeometry) G.children[G.children.length - 1].scale.set(1, 1, 0.55);
        add(new T.BoxGeometry(w * 0.7, 0.3, 0.3), 'zip', 0, h * 0.7, 0, { finish: 'metal', hex: '#c4a15a' });
        label = { pos: [0, h * 0.35, h * 0.2], w: w * 0.5, h: h * 0.25 }; break;
      case 'candle':
        r = w / 2;
        add(new T.CylinderGeometry(r, r, h, 32, 1, true), 'glass', 0, h / 2, 0, { finish: 'glass', hex: '#ffffff' });
        add(new T.CylinderGeometry(r * 0.92, r * 0.92, h * 0.8, 32), 'body', 0, h * 0.4);
        add(new T.CylinderGeometry(0.08, 0.08, 1, 6), 'wick', 0, h * 0.85, 0, { finish: 'plastic', hex: '#26221f' });
        label = { pos: [0, h * 0.42, r + 0.03], w: w * 0.75, h: h * 0.35, bg: true }; break;
      case 'lanyard':
        add(new T.TorusGeometry(w * 0.4, 0.5, 8, 30, Math.PI), 'body', 0, h * 0.45, 0);
        add(new T.BoxGeometry(w * 0.7, h * 0.45, 0.3), 'holder', 0, h * 0.22, 0, { finish: 'glass', hex: '#ffffff' });
        add(new T.BoxGeometry(w * 0.6, h * 0.38, 0.1), 'card', 0, h * 0.22, 0, { finish: 'paper', hex: '#f7f2e9' });
        label = { pos: [0, h * 0.22, 0.17], w: w * 0.55, h: h * 0.3 }; break;
      case 'usb':
        add(new T.BoxGeometry(w, h * 0.75, 0.8), 'body', 0, h * 0.375);
        add(new T.BoxGeometry(w * 0.6, h * 0.3, 0.45), 'plug', 0, h * 0.85, 0, { finish: 'metal', hex: '#c9cdd0' });
        label = { pos: [0, h * 0.4, 0.42], w: w * 0.8, h: h * 0.4, rotZ: Math.PI / 2 }; break;
      case 'card':
        add(new T.BoxGeometry(w, h, 0.15), 'body', 0, h / 2);
        label = { pos: [0, h * 0.5, 0.08], w: w * 0.85, h: h * 0.6 }; break;
      case 'coaster':
        for (var cs = 0; cs < 4; cs++) add(new T.CylinderGeometry(w / 2, w / 2, 0.4, 40), 'body', 0, w / 2, cs * 0.45 - 0.7, { rx: Math.PI / 2 });
        label = { pos: [0, w / 2, 1.0], w: w * 0.6, h: w * 0.6 }; break;
      case 'frame':
        add(new T.BoxGeometry(w, h, 1.5), 'body', 0, h / 2);
        add(new T.PlaneGeometry(w * 0.72, h * 0.7), 'photo', 0, h * 0.53, 0.76, { finish: 'paper', hex: '#b4c3a6' });
        label = { pos: [0, h * 0.09, 0.77], w: w * 0.7, h: h * 0.1 }; break;
      case 'diya':
        var pts = []; for (var di = 0; di <= 10; di++) { var tt = di / 10; pts.push(new T.Vector2(w / 2 * Math.sin(tt * Math.PI / 2) + 0.05, h * 0.75 * (1 - Math.cos(tt * Math.PI / 2)))); }
        add(new T.LatheGeometry(pts, 40), 'body', 0, 0, 0);
        G.children[G.children.length - 1].material = BODY;
        add(new T.ConeGeometry(0.5, 1.6, 12), 'flame', w * 0.3, h * 0.9, 0, { finish: 'plastic', hex: '#e89b3c' });
        break;
      case 'keepsake':
        add(new T.BoxGeometry(w, h * 0.7, w * 0.7), 'body', 0, h * 0.35);
        add(new T.BoxGeometry(w * 1.02, h * 0.3, w * 0.72), 'body', 0, h * 0.85);
        add(new T.BoxGeometry(w * 0.12, h * 0.18, 0.2), 'clasp', 0, h * 0.7, w * 0.36, { finish: 'metal', hex: '#c4a15a' });
        label = { pos: [0, h * 1.002, 0], w: w * 0.6, h: w * 0.3, rotX: -Math.PI / 2 }; break;
      default:
        add(new T.BoxGeometry(w, h, Math.min(w, 6)), 'body', 0, h / 2);
        label = { pos: [0, h / 2, Math.min(w, 6) / 2 + 0.03], w: w * 0.8, h: h * 0.3 };
    }
    G.traverse(function (o) { if (o.isMesh && o.material !== BODY) self.keepMats.add(o.material); });
    var bb = new T.Box3().setFromObject(G);
    var rec = { group: G, label: label, size: bb.getSize(new T.Vector3()), min: bb.min.clone(), flat: ['notebook', 'journal', 'planner', 'folder', 'kit', 'card', 'frame', 'penset', 'chocobox', 'tote', 'coffeebag', 'pouch', 'lanyard'].indexOf(p.icon) >= 0 };
    this.protoCache.set(p.id, rec);
    return rec;
  };

  /* optional GLB model: loaded once, cloned per copy */
  proto3._model = function (url) {
    var T = window.THREE, self = this;
    if (!T.GLTFLoader) return null;
    var rec = this.modelCache.get(url);
    if (rec) return rec.scene || null;
    rec = { scene: null, failed: false };
    this.modelCache.set(url, rec);
    new T.GLTFLoader().load(url, function (gltf) {
      rec.scene = gltf.scene;
      rec.scene.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      self._rebuild();
    }, undefined, function (err) {
      rec.failed = true;
      if (window.console) console.warn('[KORE preview] Model failed, keeping the placeholder:', url, err && err.message);
    });
    return null;
  };

  proto3._productInstance = function (p, item, cat) {
    var T = window.THREE, self = this;
    var colourId = item.colour;
    var hex = colourId && cat.colours[colourId] ? cat.colours[colourId].hex : '#c9c2b6';
    var pr = this._productProto(p);
    var obj, model = p.model ? this._model(p.model) : null;
    if (model) {
      obj = model.clone(true);
      var bb = new T.Box3().setFromObject(obj), size = bb.getSize(new T.Vector3());
      var s = p.dims[1] / (size.y || 1);
      obj.scale.setScalar(s);
      obj.position.y = -bb.min.y * s;
      // Colour only parts the model names "body" (mesh or material name).
      // A single combined mesh with one material is tinted as a whole.
      var meshes = [];
      obj.traverse(function (o) { if (o.isMesh) meshes.push(o); });
      meshes.forEach(function (o) {
        var named = /body/i.test(o.name) || (o.material && /body/i.test(o.material.name));
        if (colourId && (named || meshes.length === 1)) {
          o.material = o.material.clone(); o.material.color = new T.Color(hex); self.disposables.push(o.material);
        }
      });
      var wrap = new T.Group(); wrap.add(obj); obj = wrap;
    } else {
      obj = pr.group.clone(true);
      var bodyMat = this._mat(finishFor(p.icon, colourId), hex);
      obj.traverse(function (o) { if (o.isMesh && o.userData.part === 'body') o.material = bodyMat; });
    }
    var pers = item.personal;
    if (pers && pers.on && (pers.text || pers.logo) && pr.label && !model) {
      var engrave = pers.method === 'engrave' || pers.method === 'emboss';
      var font = (cat.fonts.filter(function (f) { return f.id === pers.font; })[0] || cat.fonts[1]).css;
      var tone = engrave ? (new T.Color(hex).getHSL({}).l > 0.5 ? 'rgba(40,30,20,0.55)' : 'rgba(255,255,255,0.6)') : (cat.colours[pers.textColour] || { hex: '#C4A15A' }).hex;
      var L = pr.label;
      var rec = this._label({ lines: [pers.text], logo: pers.logo ? (this.lastCtx.logoUrl || '__ph__') : null, colour: tone, font: font, aspect: L.w / L.h, engrave: engrave, bg: L.bg ? '#F7F2E9' : null });
      var plane = this._labelPlane(rec, L.w, L.h);
      plane.position.set(L.pos[0], L.pos[1], L.pos[2]);
      if (L.rotX) plane.rotation.x = L.rotX;
      if (L.rotZ) plane.rotation.z = L.rotZ;
      plane.castShadow = false;
      obj.add(plane);
    } else if (pr.label && pr.label.bg && !model) {
      var plain = this._label({ lines: [], colour: '#6B6055', font: 'serif', aspect: pr.label.w / pr.label.h, bg: '#F7F2E9' });
      var pl = this._labelPlane(plain, pr.label.w, pr.label.h);
      pl.position.set(pr.label.pos[0], pr.label.pos[1], pr.label.pos[2]);
      obj.add(pl);
    }
    obj.userData.itemUid = item.uid;
    obj.userData.productName = p.name;
    return { obj: obj, size: model ? new T.Box3().setFromObject(obj).getSize(new T.Vector3()) : pr.size, flat: pr.flat };
  };

  /* ---------- building the hamper ---------- */
  proto3._disposeObject = function (obj, geometriesToo) {
    obj.traverse(function (o) {
      if (geometriesToo && o.geometry) o.geometry.dispose();
      if (geometriesToo && o.material) [].concat(o.material).forEach(function (m) { m.dispose(); });
    });
    if (obj.parent) obj.parent.remove(obj);
  };

  proto3._disposeBuild = function () {
    if (this.hamper) { this.root.remove(this.hamper); this.hamper = null; }
    (this.disposables || []).forEach(function (d) { try { d.dispose(); } catch (e) { /* ignore */ } });
    this.disposables = [];
  };

  proto3._prune = function () {
    var id = this.buildId;
    var keep = this.keepMats;
    this.matCache.forEach(function (v, k, m) { if (!keep.has(v.mat) && id - v.used > 3) { v.mat.dispose(); m.delete(k); } });
    this.texCache.forEach(function (v, k, m) { if (!v.keep && id - v.used > 3) { v.tex.dispose(); m.delete(k); } });
  };

  proto3._build = function (cfg, cat, ctx) {
    var T = window.THREE, self = this;
    var P = ctx.pricing || window.KorePricing;
    this.lastCtx = ctx;
    var prevLid = this.lid && this.lidKey ? { key: this.lidKey, pos: this.lid.position.clone(), q: this.lid.quaternion.clone() } : null;
    this._disposeBuild();
    this.buildId++;
    var hamper = new T.Group();
    this.hamper = hamper;

    var box = P.findBox(cat, cfg.boxId), si = P.sizeInfo(cat, box, cfg.size);
    var W = si.dims[0], D = si.dims[1], H = si.dims[2];
    if (box.shape === 'square' || box.shape === 'round') D = W;
    var round = box.shape === 'round';
    var t = box.shape === 'bag' ? 0.25 : (box.texture === 'wood' ? 1.1 : 0.5);
    var lidUp = box.lid === 'lift-off' || box.lid === 'magnetic' ? D * 0.96 : 0;
    var geomChanged = !this.geom || this.geom.W !== W || this.geom.D !== D || this.geom.H !== H || this.geom.lidUp !== lidUp;
    this.geom = { W: W, D: D, H: H, t: t, lidUp: lidUp };
    function hex(id, fb) { return id && cat.colours[id] ? cat.colours[id].hex : (fb || '#cfc6b8'); }

    var fin = {};
    cfg.finishing.forEach(function (id) { fin[id] = P.findFinishing(cat, id); });
    var ribbonId = fin['ribbon-satin'] ? 'ribbon-satin' : (fin['ribbon-grosgrain'] ? 'ribbon-grosgrain' : null);
    var ribbonMat = ribbonId ? this._mat(ribbonId === 'ribbon-satin' ? 'ribbon' : 'grosgrain', hex(cfg.colours.ribbon)) : null;

    var finishByTex = { paper: 'paper', linen: 'linen', wood: 'wood', weave: 'weave', canvas: 'canvas', kraft: 'kraft' };
    var boxFinish = finishByTex[box.texture] || 'paper';
    var extMat = fin['wrap-premium'] ? this._mat('wrap', '#ffffff') : this._mat(boxFinish, hex(cfg.colours.exterior));
    var lidMat = fin['wrap-premium'] ? extMat : this._mat(boxFinish, hex(cfg.colours.lid || cfg.colours.exterior));
    var intFinish = cfg.lining === 'satin' ? 'satin' : (cfg.lining === 'suede' ? 'suede' : boxFinish);
    var intMat = this._mat(intFinish, hex(cfg.colours.interior));
    var edgeMat = this._mat(boxFinish === 'paper' ? 'edge' : boxFinish, hex(cfg.colours.exterior));
    var foilMat = fin['foil-edge'] ? this._mat('metal', '#C4A15A') : null;

    /* --- box body --- */
    var body = new T.Group();
    if (round) {
      var R = W / 2;
      var outer = this._mesh(this._g(new T.CylinderGeometry(R, R, H, 72, 1, true)), extMat);
      outer.position.y = H / 2; body.add(outer);
      var inner = this._mesh(this._g(new T.CylinderGeometry(R - t, R - t, H - 0.01, 72, 1, true)), this._mat(intFinish, hex(cfg.colours.interior), 'back'));
      inner.position.y = H / 2; body.add(inner);
      var rim = this._mesh(this._g(new T.RingGeometry(R - t, R, 72)), edgeMat);
      rim.rotation.x = -Math.PI / 2; rim.position.y = H; body.add(rim);
      var base = this._mesh(this._g(new T.CircleGeometry(R - t, 72)), intMat);
      base.rotation.x = -Math.PI / 2; base.position.y = t; body.add(base);
      var under = this._mesh(this._g(new T.CircleGeometry(R, 72)), extMat);
      under.rotation.x = Math.PI / 2; under.position.y = 0.01; body.add(under);
    } else {
      var inMat = box.shape === 'basket' ? extMat : intMat;
      var slab = function (w, h, d, x, y, z, mats) { var m = self._mesh(self._g(new T.BoxGeometry(w, h, d)), mats); m.position.set(x, y, z); body.add(m); return m; };
      // material order: +x, -x, +y, -y, +z, -z
      slab(W, H, t, 0, H / 2, D / 2 - t / 2, [extMat, extMat, edgeMat, extMat, extMat, inMat]);
      slab(W, H, t, 0, H / 2, -D / 2 + t / 2, [extMat, extMat, edgeMat, extMat, inMat, extMat]);
      slab(t, H, D - 2 * t, -W / 2 + t / 2, H / 2, 0, [inMat, extMat, edgeMat, extMat, extMat, extMat]);
      slab(t, H, D - 2 * t, W / 2 - t / 2, H / 2, 0, [extMat, inMat, edgeMat, extMat, extMat, extMat]);
      slab(W - 2 * t, t, D - 2 * t, 0, t / 2, 0, [inMat, inMat, inMat, extMat, inMat, inMat]);
      if (foilMat && box.lid === 'none') slab(W + 0.05, 0.25, D + 0.05, 0, H - 0.1, 0, [foilMat, foilMat, foilMat, foilMat, foilMat, foilMat]);
    }
    hamper.add(body);

    /* handles */
    if (box.shape === 'basket') {
      var hMat = this._mat('weave', new T.Color(hex(cfg.colours.exterior)).offsetHSL(0, 0, -0.12).getStyle());
      var handle = this._mesh(this._g(new T.TorusGeometry(W * 0.34, 0.7, 12, 48, Math.PI)), hMat);
      handle.position.y = H - 0.5; hamper.add(handle);
    }
    if (box.shape === 'bag') {
      var ropeMat = this._mat('canvas', new T.Color(hex(cfg.colours.exterior)).offsetHSL(0, 0, -0.2).getStyle());
      [D / 2 - t, -D / 2 + t].forEach(function (z) {
        var rope = self._mesh(self._g(new T.TorusGeometry(W * 0.2, 0.45, 10, 32, Math.PI)), ropeMat);
        rope.position.set(0, H - 0.3, z); hamper.add(rope);
      });
    }

    /* --- labels (hamper personalisation) --- */
    var hp = cfg.hamper;
    var hfont = (cat.fonts.filter(function (f) { return f.id === hp.font; })[0] || cat.fonts[0]).css;
    var hlines = [hp.company, hp.name, hp.event, hp.greeting, hp.tagline].filter(Boolean);
    var hasLabel = hlines.length || hp.useLogo;
    function boxLabel(aspect) { return self._label({ lines: hlines, logo: hp.useLogo ? (ctx.logoUrl || '__ph__') : null, colour: hex(hp.textColour, '#C4A15A'), font: hfont, aspect: aspect }); }

    var placement = hp.placement;
    var sleeveOn = !!fin.sleeve && !round;
    if (sleeveOn) {
      var sh = H * 0.42, sCol = new T.Color(hex(cfg.colours.exterior)).getHSL({}).l > 0.45 ? '#26221F' : '#EDE3CF';
      var sMat = this._mat('paper', sCol);
      var sl = this._mesh(this._g(new T.BoxGeometry(W + 0.12, sh, D + 0.12)), [sMat, sMat, this._mat('shadow', '#000'), this._mat('shadow', '#000'), sMat, sMat]);
      sl.material[2] = new T.MeshBasicMaterial({ visible: false }); sl.material[3] = sl.material[2]; this.disposables.push(sl.material[2]);
      sl.position.y = H * 0.48; hamper.add(sl);
      if (hasLabel && placement === 'sleeve') {
        var sp = this._labelPlane(boxLabel(W / sh), W * 0.9, sh * 0.9);
        sp.position.set(0, H * 0.48, D / 2 + 0.08); hamper.add(sp);
      }
    }
    if (hasLabel && (placement === 'front' || (placement === 'lid' && box.lid === 'none'))) {
      var fh = H * 0.5, fw = (round ? W * 0.7 : W * 0.8);
      var fy = sleeveOn ? H * 0.82 : H * 0.5;
      if (sleeveOn) fh = H * 0.28;
      var fp;
      if (round) {
        var arc = Math.min(Math.PI * 0.7, fw / (W / 2));
        var cylG = this._g(new T.CylinderGeometry(W / 2 + 0.06, W / 2 + 0.06, fh, 32, 1, true, -arc / 2, arc));
        var lrec = boxLabel(fw / fh);
        var lm = new T.MeshStandardMaterial({ map: lrec.tex, transparent: true, depthWrite: false, roughness: 0.6 });
        this.disposables.push(lm);
        fp = new T.Mesh(cylG, lm);
        fp.position.y = fy;
      } else {
        fp = this._labelPlane(boxLabel(fw / fh), fw, fh);
        fp.position.set(0, fy, D / 2 + (box.shape === 'basket' ? 0.4 : 0.03));
      }
      hamper.add(fp);
    }

    /* --- ribbon on the box --- */
    var bw = Math.max(1.6, Math.min(3, W * 0.08));
    if (ribbonMat && !round && (box.shape === 'square' || box.shape === 'rect')) {
      var rb = function (w, h, d, x, y, z) { var m = self._mesh(self._g(new T.BoxGeometry(w, h, d)), ribbonMat); m.position.set(x, y, z); hamper.add(m); };
      rb(bw, H, 0.08, 0, H / 2, D / 2 + 0.05);
      rb(bw, H, 0.08, 0, H / 2, -D / 2 - 0.05);
      rb(0.08, H, bw, W / 2 + 0.05, H / 2, 0);
      rb(0.08, H, bw, -W / 2 - 0.05, H / 2, 0);
      if (hp.ribbonText) {
        var rt = this._label({ lines: [hp.ribbonText], colour: new T.Color(hex(cfg.colours.ribbon)).getHSL({}).l > 0.5 ? '#26221F' : '#F7F2E9', font: "'Manrope', sans-serif", aspect: H / bw });
        var rtp = this._labelPlane(rt, H * 0.9, bw * 0.9);
        rtp.rotation.z = Math.PI / 2; rtp.position.set(0, H / 2, D / 2 + 0.1); hamper.add(rtp);
      }
    }
    if (ribbonMat && round) {
      var band = this._mesh(this._g(new T.CylinderGeometry(W / 2 + 0.07, W / 2 + 0.07, bw, 72, 1, true)), ribbonMat);
      band.position.y = H * 0.45; hamper.add(band);
    }
    if (ribbonMat && (box.shape === 'basket' || box.shape === 'bag')) {
      var hb = this._mesh(this._g(new T.TorusGeometry(box.shape === 'basket' ? 1.1 : 0.8, 0.5, 10, 24)), ribbonMat);
      if (box.shape === 'basket') { hb.position.set(-W * 0.34, H + 0.5, 0); hb.rotation.y = Math.PI / 2; }
      else hb.position.set(-W * 0.2, H + 0.2, D / 2 - t);
      hamper.add(hb);
    }

    /* --- seal stickers, wax seal (front, when the lid is not carrying them) --- */
    var showLid = box.lid !== 'none' && this.view !== 'top' && this.view !== 'inside';
    var lidClosed = showLid && this.lidClosed;
    if (fin['seal-stickers']) {
      var stMat = this._mat('paper', '#EDE3CF'), stEdge = this._mat('paper', '#A8562E');
      [-1, 1].forEach(function (sx) {
        var st = self._mesh(self._g(new T.CylinderGeometry(1.2, 1.2, 0.06, 32)), [stEdge, stMat, stMat]);
        st.rotation.x = Math.PI / 2; st.position.set(sx * Math.min(W * 0.18, 4), H - 2, (round ? W / 2 : D / 2) + 0.08); hamper.add(st);
      });
    }
    var waxMesh = function () {
      var m = self._mesh(self._g(new T.CylinderGeometry(1.6, 1.75, 0.45, 12)), self._mat('wax', '#8E2A22'));
      return m;
    };
    if (fin['wax-seal'] && !showLid) {
      var wx = waxMesh(); wx.rotation.x = Math.PI / 2; wx.position.set(0, H * 0.82, (round ? W / 2 : D / 2) + 0.25); hamper.add(wx);
    }

    /* --- filling (cached: rebuilt only when it changes) --- */
    var filling = P.findFilling(cat, cfg.fillingId);
    var fillH = filling.texture === 'none' ? t : H * 0.56;
    var fkey = [box.shape, W, D, H, t, filling.id, cfg.fillingColour].join('|');
    if (!this.fill || this.fill.key !== fkey) {
      if (this.fill) this._disposeObject(this.fill.group, true);
      this.fill = { key: fkey, group: this._buildFilling(filling, hex(cfg.fillingColour, '#d8cbb6'), W, D, H, t, fillH, round) };
    }
    hamper.add(this.fill.group);

    /* --- products: approximate, balanced arrangement --- */
    var prodGroup = new T.Group();
    prodGroup.name = 'products';
    var innerW = W - 2 * t - 1.2, innerD = D - 2 * t - 1.2;
    var pieces = [];
    cfg.items.forEach(function (it) {
      var p = P.findProduct(cat, it.productId);
      if (!p) return;
      var copies = Math.min(it.qty, 4);
      for (var c = 0; c < copies; c++) pieces.push({ p: p, it: it, copy: c });
    });
    pieces = pieces.map(function (pc) { var inst = self._productInstance(pc.p, pc.it, cat); pc.obj = inst.obj; pc.size = inst.size; pc.flat = inst.flat; return pc; });
    pieces.sort(function (a, b) { return b.size.y - a.size.y; });
    var rows = [], row = null, gap = 0.6;
    function rowWidthAt(z) { if (!round) return innerW; var rr = W / 2 - t - 0.6; return 2 * Math.sqrt(Math.max(0, rr * rr - z * z)); }
    pieces.forEach(function (pc) {
      var fw = pc.size.x, fd = pc.size.z;
      if (!row || row.w + gap + fw > innerW * (round ? 0.92 : 1)) { row = { items: [], w: 0, d: 0 }; rows.push(row); }
      row.items.push(pc); row.w += (row.items.length > 1 ? gap : 0) + fw; row.d = Math.max(row.d, fd);
    });
    var totalD = rows.reduce(function (s, r2) { return s + r2.d; }, 0) + gap * Math.max(0, rows.length - 1);
    var overflow = totalD > innerD || rows.some(function (r2) { return r2.w > innerW; });
    var squeeze = totalD > innerD ? innerD / totalD : 1;
    var z = -innerD / 2;
    if (totalD < innerD) z = -totalD / 2 - (innerD - totalD) * 0.12;
    rows.forEach(function (r2) {
      var rz = z + r2.d * squeeze / 2;
      var avail = rowWidthAt(rz);
      var scaleX = r2.w > avail ? avail / r2.w : 1;
      if (r2.w > avail + 0.5) overflow = true;
      var x = -Math.min(r2.w, avail) / 2;
      r2.items.forEach(function (pc) {
        var fw = pc.size.x * scaleX;
        var cx = x + fw / 2;
        x += fw + gap * scaleX;
        var rnd = rng(hash(pc.it.uid + ':' + pc.copy));
        var sink = filling.texture === 'none' ? 0 : Math.min(pc.size.y * 0.22, fillH * 0.5);
        pc.obj.position.set(cx, fillH - sink, rz);
        pc.obj.rotation.y = (rnd() - 0.5) * 0.24;
        if (pc.flat && pc.size.y > pc.size.z * 2) pc.obj.rotation.x = -0.14;
        prodGroup.add(pc.obj);
      });
      z += r2.d * squeeze + gap * squeeze;
    });
    hamper.add(prodGroup);
    this.products = prodGroup;
    this.layout = { overflow: overflow, rows: rows.length, shown: pieces.length };

    /* --- greeting card --- */
    var cardF = fin['card-greeting'] || fin['card-thanks'] || fin['card-message'];
    if (cardF) {
      var ctext = fin['card-message'] ? (hp.message || 'Your message') : (fin['card-thanks'] ? 'Thank you' : (hp.greeting || 'Greetings'));
      var cw = Math.min(10, W * 0.32), chh = cw * 1.4;
      var crec = this._label({ lines: [ctext.length > 70 ? ctext.slice(0, 67) + '…' : ctext], colour: '#3A332C', font: hfont, aspect: cw / chh, bg: '#FBF8F2' });
      var cardG = new T.Group();
      var cardMesh = this._mesh(this._g(new T.BoxGeometry(cw, chh, 0.12)), this._mat('paper', '#FBF8F2'));
      cardMesh.position.y = chh / 2; cardG.add(cardMesh);
      var cfp = this._labelPlane(crec, cw * 0.92, chh * 0.92); cfp.position.set(0, chh / 2, 0.07); cardG.add(cfp);
      cardG.position.set(round ? W * 0.16 : W / 2 - t - cw / 2 - 1, fillH - chh * 0.18, round ? -W * 0.25 : -D / 2 + t + 1.2);
      cardG.rotation.set(-0.22, round ? 0.2 : -0.15, 0);
      hamper.add(cardG);
    }

    /* --- gift tag --- */
    if (fin['gift-tag']) {
      var tagG = new T.Group(), tw = Math.max(3.5, W * 0.11), thh = tw * 1.7;
      var tagText = hp.name || (placement === 'tag' ? hp.company : '') || '';
      var trec = this._label({ lines: tagText ? [tagText] : [], logo: placement === 'tag' && hp.useLogo ? (ctx.logoUrl || '__ph__') : null, colour: '#2B2119', font: hfont, aspect: tw / thh, bg: '#B48A5A' });
      var tagM = this._mesh(this._g(new T.BoxGeometry(tw, thh, 0.08)), this._mat('kraft', '#B48A5A'));
      tagG.add(tagM);
      var tp = this._labelPlane(trec, tw * 0.9, thh * 0.8); tp.position.z = 0.05; tagG.add(tp);
      var str = this._mesh(this._g(new T.CylinderGeometry(0.05, 0.05, 3, 6)), this._mat('fabric', '#6B6055'), { noCast: true });
      str.position.y = thh / 2 + 1.5; tagG.add(str);
      tagG.position.set(round ? W * 0.3 : W / 2 - tw * 0.7, H - thh / 2 - 1, (round ? W / 2 * 0.95 : D / 2) + 0.4);
      tagG.rotation.z = 0.12;
      hamper.add(tagG);
    }

    /* --- clear wrap --- */
    if (fin['wrap-clear']) {
      var cwMat = this._mat('clearwrap', '#ffffff');
      var shellH = H * 1.75;
      var shell = round ? new T.CylinderGeometry(W / 2 + 1, W / 2 + 0.8, shellH, 48, 1, true) : new T.BoxGeometry(W + 2, shellH, D + 2);
      var sm = new T.Mesh(this._g(shell), cwMat); sm.position.y = shellH / 2; sm.renderOrder = 3; hamper.add(sm);
      var cone = new T.Mesh(this._g(new T.ConeGeometry(Math.min(W, D) * 0.35, H * 0.7, 24, 1, true)), cwMat);
      cone.position.y = shellH + H * 0.3; cone.renderOrder = 3; hamper.add(cone);
      if (ribbonMat) { var knot = this._mesh(this._g(new T.TorusGeometry(1.4, 0.45, 10, 24)), ribbonMat); knot.position.y = shellH - 0.2; knot.rotation.x = Math.PI / 2; hamper.add(knot); }
    }

    /* --- lid --- */
    this.lid = null; this.lidKey = null;
    if (showLid) {
      var lidG = new T.Group();
      var lh = Math.min(3.2, H * 0.3), LW = W + 0.9, LD = D + 0.9;
      var sliding = box.lid === 'sliding';
      if (round) {
        var lr = W / 2 + 0.45;
        var lcyl = this._mesh(this._g(new T.CylinderGeometry(lr, lr, lh, 72)), [lidMat, lidMat, this._mat(boxFinish, hex(cfg.colours.lid || cfg.colours.exterior))]);
        lcyl.position.y = lh / 2; lidG.add(lcyl);
        if (ribbonMat) { var lband = this._mesh(this._g(new T.CylinderGeometry(lr + 0.05, lr + 0.05, Math.min(bw, lh * 0.8), 72, 1, true)), ribbonMat); lband.position.y = lh / 2; lidG.add(lband); }
        if (foilMat) { var ft = this._mesh(this._g(new T.TorusGeometry(lr, 0.18, 8, 72)), foilMat); ft.rotation.x = Math.PI / 2; ft.position.y = lh; lidG.add(ft); }
      } else if (sliding) {
        lh = 0.9;
        var plank = this._mesh(this._g(new T.BoxGeometry(W - 0.2, lh, D)), lidMat);
        plank.position.y = lh / 2; lidG.add(plank);
      } else {
        var lslab = function (w, h, d, x, y, z) { var m = self._mesh(self._g(new T.BoxGeometry(w, h, d)), lidMat); m.position.set(x, y, z); lidG.add(m); return m; };
        lslab(LW, 0.45, LD, 0, lh - 0.225, 0);
        lslab(LW, lh, 0.4, 0, lh / 2, LD / 2 - 0.2);
        lslab(LW, lh, 0.4, 0, lh / 2, -LD / 2 + 0.2);
        lslab(0.4, lh, LD - 0.8, -LW / 2 + 0.2, lh / 2, 0);
        lslab(0.4, lh, LD - 0.8, LW / 2 - 0.2, lh / 2, 0);
        if (ribbonMat) {
          var lrb = function (w, h, d, x, y, z) { var m = self._mesh(self._g(new T.BoxGeometry(w, h, d)), ribbonMat); m.position.set(x, y, z); lidG.add(m); };
          lrb(bw, 0.08, LD + 0.1, 0, lh + 0.04, 0);
          lrb(LW + 0.1, 0.08, bw, 0, lh + 0.04, 0);
          lrb(bw, lh, 0.08, 0, lh / 2, LD / 2 + 0.05); lrb(bw, lh, 0.08, 0, lh / 2, -LD / 2 - 0.05);
          lrb(0.08, lh, bw, LW / 2 + 0.05, lh / 2, 0); lrb(0.08, lh, bw, -LW / 2 - 0.05, lh / 2, 0);
        }
        if (foilMat) {
          var fe = function (w, d, x, z) { var m = self._mesh(self._g(new T.BoxGeometry(w, 0.12, d)), foilMat); m.position.set(x, lh + 0.02, z); lidG.add(m); };
          fe(LW, 0.35, 0, LD / 2 - 0.18); fe(LW, 0.35, 0, -LD / 2 + 0.18); fe(0.35, LD, LW / 2 - 0.18, 0); fe(0.35, LD, -LW / 2 + 0.18, 0);
        }
      }
      var topY = lh + (ribbonMat && !sliding ? 0.1 : 0.02);
      if (hasLabel && placement === 'lid') {
        var lsz = Math.min(LW, round ? LW : LD) * (!lidClosed && fin.bow && ribbonMat ? 0.5 : 0.68);
        var lp = this._labelPlane(boxLabel(LW / (round ? LW : LD)), lsz * (round ? 1 : LW / LD > 1 ? 1 : LW / LD), lsz * (round ? 1 : LD / LW > 1 ? 1 : LD / LW));
        lp.scale.set(1, 1, 1);
        lp.rotation.x = -Math.PI / 2; lp.position.y = topY + 0.02;
        // closed: front half of the lid; standing open: upper half, clear of the products
        if (!round) lp.position.z = lidClosed ? (ribbonMat ? LD * 0.18 : 0) : (fin.bow && ribbonMat ? LD * 0.06 : -LD * 0.1);
        else if (!lidClosed) lp.position.z = -LW * 0.1;
        lidG.add(lp);
      }
      if (fin.bow && ribbonMat) { var bowG = this._bow(ribbonMat, Math.max(0.7, Math.min(1.4, W / 26))); bowG.position.y = topY; if (!lidClosed && !sliding) bowG.position.z = -(round ? LW : LD) * 0.36; lidG.add(bowG); }
      if (fin['wax-seal']) { var wl = waxMesh(); wl.position.set(ribbonMat ? LW * 0.25 : 0, topY + 0.2, ribbonMat ? LD * 0.25 : 0); lidG.add(wl); }
      hamper.add(lidG);
      this.lid = lidG;

      // target pose
      var targetPos = new T.Vector3(), targetQ = new T.Quaternion();
      if (lidClosed) {
        targetPos.set(0, sliding ? H : H - lh * 0.85, 0);
      } else if (sliding) {
        targetPos.set(0, H, -D * 0.6);
      } else {
        targetQ.setFromEuler(new T.Euler(1.3, 0, 0));
        lidG.position.set(0, 0, 0); lidG.quaternion.copy(targetQ); lidG.updateMatrixWorld(true);
        var lbb = new T.Box3().setFromObject(lidG);
        targetPos.set(0, -lbb.min.y, -(D / 2 + 0.6) - lbb.max.z);
      }
      var lk = [box.id, W, D, H].join('|');
      this.lidKey = lk;
      if (prevLid && prevLid.key === lk && !reduceMotion && (!prevLid.pos.equals(targetPos) || !prevLid.q.equals(targetQ))) {
        lidG.position.copy(prevLid.pos); lidG.quaternion.copy(prevLid.q);
        this.lidAnim = { fromPos: prevLid.pos, toPos: targetPos, fromQ: prevLid.q, toQ: targetQ, t0: performance.now(), dur: 650 };
      } else {
        lidG.position.copy(targetPos); lidG.quaternion.copy(targetQ); this.lidAnim = null;
      }
    } else if (fin.bow && ribbonMat) {
      var b2 = this._bow(ribbonMat, Math.max(0.7, Math.min(1.4, W / 26)));
      if (box.shape === 'basket') b2.position.set(-W * 0.34, H + 1.2, 0);
      else if (box.shape === 'bag') b2.position.set(-W * 0.2, H + 1, D / 2 - t);
      else { b2.position.set(0, H, (round ? W / 2 : D / 2)); b2.rotation.x = Math.PI / 2; }
      if (box.shape === 'basket' || box.shape === 'bag') b2.rotation.x = Math.PI / 2;
      hamper.add(b2);
    }

    this.root.add(hamper);
    this._prune();
    if (geomChanged) {
      this._applyLimits();
      if (this.view !== 'custom') { var cv = this._cameraFor(this.view); this._animateTo(cv.pos, cv.target, this.buildId <= 1); }
    }
    this.dirty = true;
    if (this.onlayout) this.onlayout(this.layout);
  };

  proto3._bow = function (mat, s) {
    var T = window.THREE, g = new T.Group(), self = this;
    [-1, 1].forEach(function (side) {
      var loop = self._mesh(self._g(new T.TorusGeometry(2.2, 0.55, 10, 28)), mat);
      loop.scale.set(1, 0.62, 0.45);
      loop.position.set(side * 2.1, 1.1, 0);
      loop.rotation.set(Math.PI / 2 - 0.5, side * 0.35, 0);
      g.add(loop);
      var tail = self._mesh(self._g(new T.BoxGeometry(1.1, 0.08, 4.2)), mat);
      tail.position.set(side * 1.1, 0.08, 1.9); tail.rotation.y = side * 0.35;
      g.add(tail);
    });
    var knot = this._mesh(this._g(new T.SphereGeometry(0.9, 16, 12)), mat);
    knot.scale.set(1, 0.8, 0.8); knot.position.y = 0.8; g.add(knot);
    g.scale.setScalar(s);
    return g;
  };

  proto3._buildFilling = function (filling, colourHex, W, D, H, t, fillH, round) {
    var T = window.THREE, g = new T.Group();
    if (filling.texture === 'none') return g;
    var r = rng(hash(filling.id + colourHex + W + D));
    var innerW = W - 2 * t - 0.1, innerD = D - 2 * t - 0.1, R = W / 2 - t - 0.05;
    var finish = { satin: 'satin', fabric: 'fabric', jute: 'canvas', honeycomb: 'kraft' }[filling.texture] || 'paper';
    var amp = { tissue: 2.4, fabric: 1.4, satin: 1.6, honeycomb: 0.4 }[filling.texture] || 0.9;
    var baseCol = new T.Color(colourHex);
    var geo = round ? new T.CircleGeometry(R, 64, 0, Math.PI * 2) : new T.PlaneGeometry(innerW, innerD, 40, 40);
    if (round) {
      // a circle needs inner rings to displace: rebuild as a polar grid
      geo.dispose();
      geo = new T.RingGeometry(0.01, R, 64, 20);
    }
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position, seedA = r() * 10, seedB = r() * 10;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var edge = round ? Math.sqrt(x * x + z * z) / R : Math.max(Math.abs(x) / (innerW / 2), Math.abs(z) / (innerD / 2));
      var wave = Math.sin(x * 0.35 + seedA) * Math.cos(z * 0.3 + seedB) + 0.5 * Math.sin(x * 0.9 + z * 0.7 + seedA * 2);
      if (filling.texture === 'tissue') wave += 0.8 * Math.abs(Math.sin(x * 0.18 + z * 0.12 + seedB));
      pos.setY(i, wave * amp * 0.5 + Math.pow(edge, 4) * 1.6);
    }
    geo.computeVertexNormals();
    var mat = new T.MeshStandardMaterial({ color: baseCol.clone().offsetHSL(0, 0, ['shred', 'crinkle', 'jute'].indexOf(filling.texture) >= 0 ? -0.08 : 0), roughness: finish === 'satin' ? 0.3 : 0.95, metalness: finish === 'satin' ? 0.1 : 0 });
    if (finish === 'satin') { mat.dispose(); mat = new T.MeshPhysicalMaterial({ color: baseCol, roughness: 0.3, metalness: 0.08, sheen: 0.7, sheenColor: baseCol.clone().offsetHSL(0, 0, 0.2), clearcoat: 0.25 }); }
    if (filling.texture === 'honeycomb') mat.map = this._tex('honeycomb');
    if (filling.texture === 'fabric') mat.map = this._tex('cloth');
    mat.side = T.DoubleSide;
    var mound = new T.Mesh(geo, mat);
    mound.position.y = fillH - 0.9;
    mound.receiveShadow = true;
    g.add(mound);

    // strands for shredded, crinkle and jute fillings
    if (['shred', 'crinkle', 'jute'].indexOf(filling.texture) >= 0) {
      var area = round ? Math.PI * R * R : innerW * innerD;
      var count = Math.min(this.small ? 900 : 1600, Math.round(area * (filling.texture === 'jute' ? 1.1 : 1.5)));
      var sg = filling.texture === 'crinkle' ? new T.BoxGeometry(0.55, 0.06, 2.4) : (filling.texture === 'jute' ? new T.CylinderGeometry(0.05, 0.05, 5, 4) : new T.BoxGeometry(0.28, 0.04, 3.6));
      if (filling.texture === 'jute') sg.rotateX(Math.PI / 2);
      var smat = new T.MeshStandardMaterial({ roughness: 0.9, metalness: filling.colours.indexOf('gold') >= 0 && colourHex.toLowerCase() === '#c4a15a' ? 0.5 : 0 });
      var inst = new T.InstancedMesh(sg, smat, count);
      var m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3(1, 1, 1), c = new T.Color();
      for (var k = 0; k < count; k++) {
        var px, pz;
        if (round) { var a = r() * Math.PI * 2, rr = Math.sqrt(r()) * (R - 1.2); px = Math.cos(a) * rr; pz = Math.sin(a) * rr; }
        else { px = (r() - 0.5) * (innerW - 2); pz = (r() - 0.5) * (innerD - 2); }
        var edge2 = round ? Math.sqrt(px * px + pz * pz) / R : Math.max(Math.abs(px) / (innerW / 2), Math.abs(pz) / (innerD / 2));
        p.set(px, fillH - 0.6 + r() * 1.3 + Math.pow(edge2, 4) * 1.4, pz);
        e.set((r() - 0.5) * (filling.texture === 'crinkle' ? 1.4 : 0.6), r() * Math.PI, (r() - 0.5) * (filling.texture === 'crinkle' ? 1.2 : 0.5));
        q.setFromEuler(e);
        m4.compose(p, q, sc);
        inst.setMatrixAt(k, m4);
        c.copy(baseCol).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.06, (r() - 0.5) * 0.12);
        inst.setColorAt(k, c);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.receiveShadow = true;
      inst.castShadow = false;
      g.add(inst);
    }
    return g;
  };

  /* double-click a product to fly the camera to it */
  proto3._inspect = function (e) {
    if (!this.products) return;
    var T = window.THREE, rect = this.canvas.getBoundingClientRect();
    var ndc = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    var ray = new T.Raycaster(); ray.setFromCamera(ndc, this.camera);
    var hits = ray.intersectObjects(this.products.children, true);
    if (!hits.length) return;
    var o = hits[0].object;
    while (o && !o.userData.itemUid && o.parent) o = o.parent;
    if (!o || !o.userData.itemUid) return;
    var bb = new T.Box3().setFromObject(o), center = bb.getCenter(new T.Vector3()), size = bb.getSize(new T.Vector3());
    var dist = clamp(Math.max(size.x, size.y, size.z) * 3.2, this.controls.minDistance, this.controls.maxDistance);
    var dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.view = 'custom';
    this._animateTo(center.clone().add(dir.multiplyScalar(dist)), center, false);
    this._hideHint();
    if (this.onchange) this.onchange();
    if (this.oninspect) this.oninspect(o.userData.productName);
  };

  KP.registerRenderer('webgl', {
    isSupported: function () { return webglAvailable(); },
    create: function (el, opts) { return new Hamper3D(el, opts); }
  });
  KP.Hamper3D = Hamper3D;
})();
