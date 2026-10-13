/*
 * KORE homepage: the scroll-driven hamper film (Three.js / WebGL).
 *
 * KoreHomeScene.create(container, options) builds one scene whose every
 * object pose is a pure function of a single number, the story progress p
 * (0 = closed hamper, 1 = finished collection). The page maps scroll position
 * to p, so scrolling back plays the film backwards and a refresh lands on the
 * same frame. Nothing animates on its own; a frame is drawn only when p
 * changes or the canvas is resized.
 *
 * Products, colours and personalisation shown here come from the shared
 * catalogue (hamper-catalogue.js). All geometry is procedural, sized in cm.
 */
(function (root) {
  'use strict';

  /* ---------- the film's timeline (shared with the page captions) ---------- */
  var TIMELINE = {
    push: [0.0, 0.1],
    untie: [0.06, 0.16],
    bow: [0.08, 0.18],
    lidLift: [0.15, 0.21],
    lidOpen: [0.21, 0.29],
    tissue: [0.27, 0.35],
    warm: [0.28, 0.38],
    products: [
      { key: 'bottle', productId: 'steel-bottle', rise: [0.38, 0.43], back: [0.5, 0.54] },
      { key: 'notebook', productId: 'notebook', rise: [0.52, 0.57], back: [0.64, 0.68] },
      { key: 'mug', productId: 'mug', rise: [0.66, 0.71], back: [0.77, 0.81] },
      { key: 'pen', productId: 'pen', rise: [0.79, 0.83], back: [0.87, 0.9] }
    ],
    accessories: [0.8, 0.9],
    collection: [0.89, 1.0]
  };

  /* example personalisation shown in the film (clearly sample text) */
  var SAMPLE = { bottle: 'Priya', notebook: 'A.S.', mug: 'Ananya', pen: 'R. Mehta' };

  /* ---------- small maths helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function seg(p, r) { return clamp((p - r[0]) / (r[1] - r[0]), 0, 1); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function rng(seed) { var a = seed >>> 0; return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- scene constants (cm) ---------- */
  var W = 40, D = 30, H = 14, T = 0.6, LH = 4.2;
  var FILL = 4.6;

  function create(container, opts) {
    opts = opts || {};
    var THREE = root.THREE;
    var CAT = opts.catalogue;
    if (!THREE) throw new Error('Three.js is not loaded');
    if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

    var small = !!opts.small;
    var canvas = document.createElement('canvas');
    canvas.className = 'kh3-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('No WebGL context');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(canvas);

    var disposables = [];
    function keep(x) { disposables.push(x); return x; }
    var maxAniso = renderer.capabilities.getMaxAnisotropy();

    var scene = new THREE.Scene();
    if (THREE.RoomEnvironment) {
      var pmrem = keep(new THREE.PMREMGenerator(renderer));
      var envTex = keep(pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture);
      scene.environment = envTex;
    }
    /* lighting: a dark product-photography set. One soft warm key from the front left
       makes a pool of light on the table; a back light traces the edges of the charcoal box. */
    var hemi = new THREE.HemisphereLight(0xfff1df, 0x15110d, THREE.RoomEnvironment ? 0.16 : 0.6);
    scene.add(hemi);
    var key = new THREE.SpotLight(0xffeedd, THREE.RoomEnvironment ? 1.9 : 2.5, 0, 0.42, 0.85, 1);
    key.position.set(-58, 120, 92);
    key.target.position.set(4, 6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    key.shadow.camera.near = 60; key.shadow.camera.far = 320;
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.04; key.shadow.radius = 8;
    scene.add(key); scene.add(key.target);
    var back = new THREE.DirectionalLight(0xffd8b4, 0.95);
    back.position.set(60, 55, -90);
    scene.add(back);
    var fill = new THREE.DirectionalLight(0xc9d4ff, 0.18);
    fill.position.set(90, 30, 60);
    scene.add(fill);
    var warm = new THREE.PointLight(0xffb36b, 0, 60, 1.6);
    warm.position.set(0, H + 9, 4);
    scene.add(warm);

    var camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);

    /* ---------- procedural textures: real surface detail instead of flat colour ---------- */
    var TS = small ? 256 : 512;
    function makeCanvas(s) { var c = document.createElement('canvas'); c.width = c.height = s; return c; }
    function finishTex(c, srgb, rep) {
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (srgb) tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, maxAniso);
      if (rep) tex.repeat.set(rep[0], rep[1]);
      return keep(tex);
    }
    // tileable value noise
    function noise2(s, cells, seed) {
      var r = rng(seed), grid = [], i, j, out = new Float32Array(s * s);
      for (i = 0; i < cells * cells; i++) grid.push(r());
      function g(x, y) { return grid[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)]; }
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) {
        var fx = i / s * cells, fy = j / s * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
        out[j * s + i] = mix(mix(g(x0, y0), g(x0 + 1, y0), tx), mix(g(x0, y0 + 1), g(x0 + 1, y0 + 1), tx), ty);
      }
      return out;
    }
    function fbm(s, seed, octaves, base) {
      var out = new Float32Array(s * s), amp = 1, tot = 0;
      for (var o = 0; o < octaves; o++) { var n = noise2(s, base << o, seed + o * 31); for (var k = 0; k < out.length; k++) out[k] += n[k] * amp; tot += amp; amp *= 0.5; }
      for (var q = 0; q < out.length; q++) out[q] /= tot;
      return out;
    }
    // height field -> tangent-space normal map
    function normalFrom(hgt, s, strength) {
      var c = makeCanvas(s), g = c.getContext('2d'), img = g.createImageData(s, s), d = img.data;
      for (var j = 0; j < s; j++) for (var i = 0; i < s; i++) {
        var l = hgt[j * s + ((i - 1 + s) % s)], rr = hgt[j * s + ((i + 1) % s)], u = hgt[((j - 1 + s) % s) * s + i], dn = hgt[((j + 1) % s) * s + i];
        var nx = (l - rr) * strength, ny = (u - dn) * strength, nz = 1, len = Math.sqrt(nx * nx + ny * ny + nz * nz), k = (j * s + i) * 4;
        d[k] = (nx / len * 0.5 + 0.5) * 255; d[k + 1] = (ny / len * 0.5 + 0.5) * 255; d[k + 2] = (nz / len * 0.5 + 0.5) * 255; d[k + 3] = 255;
      }
      g.putImageData(img, 0, 0); return c;
    }
    function greyFrom(hgt, s, lo, hi) {
      var c = makeCanvas(s), g = c.getContext('2d'), img = g.createImageData(s, s), d = img.data;
      for (var k = 0; k < s * s; k++) { var v = (lo + (hi - lo) * hgt[k]) * 255; d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v; d[k * 4 + 3] = 255; }
      g.putImageData(img, 0, 0); return c;
    }
    // woven linen: over-under threads with slubs and fibre noise
    var linenH = (function () {
      var s = TS, h = new Float32Array(s * s), n = fbm(s, 11, 3, 16), threads = s / 8, i, j;
      var slubX = noise2(s, 64, 5), slubY = noise2(s, 64, 9);
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) {
        var u = i / s * threads, v = j / s * threads, cu = Math.floor(u), cv = Math.floor(v);
        var warp = Math.sin((u - cu) * Math.PI), weft = Math.sin((v - cv) * Math.PI);
        var over = (cu + cv) % 2 === 0;
        var hh = over ? Math.max(warp * 0.9 + slubX[j * s + i] * 0.25, weft * 0.55) : Math.max(weft * 0.9 + slubY[j * s + i] * 0.25, warp * 0.55);
        h[j * s + i] = hh * 0.8 + n[j * s + i] * 0.2;
      }
      return h;
    })();
    var texLinenN = finishTex(normalFrom(linenH, TS, 2.2), false);
    var texLinenC = finishTex(greyFrom(linenH, TS, 0.78, 1), true);
    // paper: soft cloud plus fibres
    var paperH = (function () {
      var s = TS, h = fbm(s, 21, 4, 8), r = rng(3);
      for (var f = 0; f < s * 3; f++) { var x = r() * s, y = r() * s, a = r() * Math.PI, len = 4 + r() * 18; for (var t = 0; t < len; t++) { var px = Math.floor(x + Math.cos(a) * t) % s, py = Math.floor(y + Math.sin(a) * t) % s; h[py * s + px] += 0.25; } }
      return h;
    })();
    var texPaperN = finishTex(normalFrom(paperH, TS, 0.9), false);
    var texPaperC = finishTex(greyFrom(paperH, TS, 0.9, 1), true);
    // pebbled leather grain
    var leatherH = (function () {
      // jittered-grid cellular noise: one seed point per cell, nearest two of the 3x3 neighbourhood
      var s = TS, h = new Float32Array(s * s), r = rng(41), cells = 40, cs = s / cells, pts = [], i, j, a, b;
      for (i = 0; i < cells * cells; i++) pts.push([r(), r()]);
      var n = fbm(s, 44, 3, 32);
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) {
        var cx = Math.floor(i / cs), cy = Math.floor(j / cs), best = 1e9, second = 1e9;
        for (b = -1; b <= 1; b++) for (a = -1; a <= 1; a++) {
          var gx = cx + a, gy = cy + b, p = pts[((gy + cells) % cells) * cells + ((gx + cells) % cells)];
          var dx = i - (gx + p[0]) * cs, dy = j - (gy + p[1]) * cs, d2 = dx * dx + dy * dy;
          if (d2 < best) { second = best; best = d2; } else if (d2 < second) second = d2;
        }
        h[j * s + i] = clamp((Math.sqrt(second) - Math.sqrt(best)) / (cs * 0.35), 0, 1) * 0.8 + n[j * s + i] * 0.2;
      }
      return h;
    })();
    var texLeatherN = finishTex(normalFrom(leatherH, TS, 1.6), false);
    // fine orange-peel powder coat
    var coatH = fbm(TS, 61, 3, 64);
    var texCoatN = finishTex(normalFrom(coatH, TS, 0.9), false);
    // satin: lengthwise sheen streaks (along v)
    var satinH = (function () {
      var s = TS, h = new Float32Array(s * s), n = noise2(s, 128, 71), m = noise2(s, 16, 73);
      for (var j = 0; j < s; j++) for (var i = 0; i < s; i++) h[j * s + i] = n[i] * 0.7 + m[(j % 16) * s + i] * 0.3;
      return h;
    })();
    var texSatinN = finishTex(normalFrom(satinH, TS, 0.7), false);
    // brushed metal
    var brushH = (function () { var s = TS, h = new Float32Array(s * s), n = noise2(s, 256, 81); for (var j = 0; j < s; j++) for (var i = 0; i < s; i++) h[j * s + i] = n[j * s + (i % 4)] * 0.5 + n[(j % s) * s] * 0.5; return h; })();
    var texBrushN = finishTex(normalFrom(brushH, TS, 0.5), false);
    // dark stone table top with a soft radial fade so it melts into the background
    var tableC = (function () {
      var s = TS, h = fbm(s, 91, 5, 4), c = makeCanvas(s), g = c.getContext('2d'), img = g.createImageData(s, s), d = img.data;
      for (var k = 0; k < s * s; k++) { var v = 0.8 + h[k] * 0.35; d[k * 4] = 50 * v; d[k * 4 + 1] = 44 * v; d[k * 4 + 2] = 38 * v; d[k * 4 + 3] = 255; }
      g.putImageData(img, 0, 0); return c;
    })();
    var texTable = finishTex(tableC, true, [3, 3]);
    var texTableFade = (function () {
      var c = makeCanvas(256), g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.42, '#fff'); gr.addColorStop(1, '#000');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      var t = new THREE.CanvasTexture(c); return keep(t);
    })();

    function hex(id, fb) { return CAT && CAT.colours[id] ? CAT.colours[id].hex : fb; }
    function std(o) { return keep(new THREE.MeshStandardMaterial(o)); }
    function phys(o) { return keep(new THREE.MeshPhysicalMaterial(o)); }
    function rep(t, x, y) { var c = t.clone(); c.needsUpdate = true; c.repeat.set(x, y); return keep(c); }
    var v2 = function (a, b) { return new THREE.Vector2(a, b === undefined ? a : b); };

    // table
    var table = new THREE.Mesh(keep(new THREE.CircleGeometry(150, 64)), std({ map: texTable, color: '#ffffff', roughness: 0.62, metalness: 0, alphaMap: texTableFade, transparent: true, depthWrite: false, envMapIntensity: 0.35 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);
    var ground = new THREE.Mesh(keep(new THREE.CircleGeometry(150, 64)), keep(new THREE.ShadowMaterial({ opacity: 0.55, transparent: true })));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.02;
    ground.receiveShadow = true;
    scene.add(ground);

    // texture repeats are in cm (extruded geometry uses cm UVs)
    var M = {
      boxOut: phys({ color: hex('black', '#2B2724'), map: rep(texLinenC, 0.09, 0.09), normalMap: rep(texLinenN, 0.09, 0.09), normalScale: v2(0.9), roughness: 0.86, sheen: 0.18, sheenRoughness: 0.6, sheenColor: new THREE.Color('#5a5048'), envMapIntensity: 0.45 }),
      boxIn: std({ color: hex('ivory', '#EDE3CF'), map: rep(texPaperC, 0.08, 0.08), normalMap: rep(texPaperN, 0.08, 0.08), normalScale: v2(0.5), roughness: 0.95, envMapIntensity: 0.6 }),
      ribbon: phys({ color: '#7A3519', roughness: 0.4, metalness: 0, normalMap: rep(texSatinN, 0.6, 0.15), normalScale: v2(0.35), sheen: 0.45, sheenRoughness: 0.4, sheenColor: new THREE.Color('#C77A4E'), clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.8, transparent: true, side: THREE.DoubleSide }),
      tissue: phys({ color: '#DDD4C4', map: rep(texPaperC, 0.12, 0.12), normalMap: rep(texPaperN, 0.12, 0.12), normalScale: v2(0.8), roughness: 0.92, sheen: 0.12, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide, transparent: true, opacity: 0.93, envMapIntensity: 0.5 }),
      gold: std({ color: hex('gold', '#C9A45C'), roughness: 0.24, metalness: 1, normalMap: rep(texBrushN, 1, 1), normalScale: v2(0.15) }),
      steelDark: std({ color: '#26231F', roughness: 0.3, metalness: 0.85, normalMap: rep(texBrushN, 1, 1), normalScale: v2(0.2) }),
      bottle: phys({ color: hex('forest', '#2F5240'), roughness: 0.55, metalness: 0.15, normalMap: rep(texCoatN, 2, 4), normalScale: v2(0.25), clearcoat: 0.08, clearcoatRoughness: 0.5 }),
      notebook: phys({ color: hex('burgundy', '#6B2234'), roughness: 0.58, normalMap: rep(texLeatherN, 0.1, 0.1), normalScale: v2(0.7), clearcoat: 0.1, clearcoatRoughness: 0.6 }),
      pages: std({ color: '#F1EADD', map: rep(texPaperC, 0.3, 0.3), roughness: 0.9 }),
      mug: phys({ color: hex('ivory', '#EDE3CF'), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, normalMap: rep(texCoatN, 1, 1), normalScale: v2(0.05) }),
      choc: std({ color: '#3B2418', map: rep(texPaperC, 0.08, 0.08), normalMap: rep(texPaperN, 0.08, 0.08), normalScale: v2(0.4), roughness: 0.72 }),
      chocSleeve: std({ color: hex('gold', '#C4A15A'), roughness: 0.34, metalness: 0.75, normalMap: rep(texPaperN, 0.08, 0.08), normalScale: v2(0.3) }),
      candleWax: phys({ color: hex('sage', '#B4C3A6'), roughness: 0.7, sheen: 0.12, sheenColor: new THREE.Color('#e9f0df') }),
      glass: phys({ color: '#ffffff', roughness: 0.03, transmission: small ? 0 : 1, thickness: 0.4, ior: 1.5, transparent: !!small, opacity: small ? 0.3 : 1, clearcoat: 1, depthWrite: !small }),
      shred: std({ roughness: 0.9, side: THREE.DoubleSide, normalMap: rep(texPaperN, 0.5, 0.5), normalScale: v2(0.5) })
    };
    M.boxEdge = M.boxOut;
    // a dark set reflects little light back: keep image-based light low on everything but the metals
    Object.keys(M).forEach(function (k) { if (k !== 'gold' && k !== 'steelDark' && k !== 'glass') M[k].envMapIntensity = Math.min(M[k].envMapIntensity, 0.42); });

    /* rounded-edge slab: a w x h x d box with softened edges, like a wrapped rigid box */
    function roundGeo(w, h, d, r) {
      r = Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
      var cr = Math.min(r, 0.2), x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r, s = new THREE.Shape();
      s.moveTo(x + cr, y); s.lineTo(x + ww - cr, y); s.quadraticCurveTo(x + ww, y, x + ww, y + cr);
      s.lineTo(x + ww, y + hh - cr); s.quadraticCurveTo(x + ww, y + hh, x + ww - cr, y + hh);
      s.lineTo(x + cr, y + hh); s.quadraticCurveTo(x, y + hh, x, y + hh - cr);
      s.lineTo(x, y + cr); s.quadraticCurveTo(x, y, x + cr, y);
      var g = new THREE.ExtrudeGeometry(s, { depth: Math.max(d - 2 * r, 0.001), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: small ? 2 : 3, curveSegments: 3 });
      g.translate(0, 0, -(d - 2 * r) / 2);
      return g;
    }

    function labelTexture(lines, o) {
      o = o || {};
      var w = 1024, h = Math.round(1024 / (o.aspect || 2));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var g = c.getContext('2d');
      g.fillStyle = o.colour || '#C4A15A';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      var y = h / 2 - ((lines.length - 1) * h * 0.18) / 2;
      lines.forEach(function (ln, i) {
        var size = i === 0 ? h * (o.size || 0.42) : h * 0.13;
        g.font = (i === 0 ? (o.weight || '600') : '600') + ' ' + Math.round(size) + 'px ' + (i === 0 ? (o.font || "'Cormorant', Georgia, serif") : "'Manrope', sans-serif");
        if (i > 0) { try { g.letterSpacing = Math.round(size * 0.35) + 'px'; } catch (e) { /* older browsers */ } }
        g.fillText(ln, w / 2, y + (i === 0 ? 0 : h * 0.06));
        y += h * 0.32;
      });
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, maxAniso);
      return keep(tex);
    }
    /* The KORE logo (img/kore-logo.png) as a lid texture. Draws when the image arrives and redraws the frame. */
    var logoReady = null;
    function logoTexture(src) {
      var c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 * 544 / 2934);
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, maxAniso);
      logoReady = new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var g = c.getContext('2d');
          g.clearRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          tex.needsUpdate = true;
          if (current >= 0) render(current);
          resolve(true);
        };
        img.onerror = function () { resolve(false); };
        img.src = src;
      });
      return keep(tex);
    }
    function labelPlane(tex, w, h, o) {
      var mat = std({ map: tex, transparent: true, roughness: (o && o.rough) || 0.45, metalness: (o && o.metal) || 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      var m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), mat);
      m.renderOrder = 2;
      return m;
    }
    function mesh(geo, mat, cast) {
      var m = new THREE.Mesh(keep(geo), mat);
      m.castShadow = cast !== false; m.receiveShadow = true;
      return m;
    }

    /* ---------- the hamper ---------- */
    var hamper = new THREE.Group();
    scene.add(hamper);

    function slab(w, h, d, x, y, z, mats, parent) { var m = mesh(new THREE.BoxGeometry(w, h, d), mats); m.position.set(x, y, z); (parent || hamper).add(m); return m; }
    // a rounded panel; rotY turns it to run along the depth
    function panel(w, h, d, x, y, z, mat, parent, rotY, r) {
      var m = mesh(roundGeo(w, h, d, r === undefined ? 0.22 : r), mat);
      m.position.set(x, y, z); if (rotY) m.rotation.y = rotY; (parent || hamper).add(m); return m;
    }
    function liner(w, h, x, y, z, rx, ry, parent) {
      var m = mesh(new THREE.PlaneGeometry(w, h), M.boxIn, false);
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); (parent || hamper).add(m); return m;
    }
    // walls: linen-wrapped rigid board with softened edges; the linen wraps over the rim
    panel(W, H, T, 0, H / 2, D / 2 - T / 2, M.boxOut);
    panel(W, H, T, 0, H / 2, -D / 2 + T / 2, M.boxOut);
    panel(D - 2 * T + 0.02, H, T, -W / 2 + T / 2, H / 2, 0, M.boxOut, null, Math.PI / 2);
    panel(D - 2 * T + 0.02, H, T, W / 2 - T / 2, H / 2, 0, M.boxOut, null, Math.PI / 2);
    slab(W - 2 * T, T, D - 2 * T, 0, T / 2, 0, M.boxIn);
    // paper lining inside, stopping just below the rim
    var LH_IN = H - 0.45;
    liner(W - 2 * T, LH_IN, 0, LH_IN / 2, D / 2 - T - 0.01, 0, Math.PI);
    liner(W - 2 * T, LH_IN, 0, LH_IN / 2, -D / 2 + T + 0.01, 0, 0);
    liner(D - 2 * T, LH_IN, -W / 2 + T + 0.01, LH_IN / 2, 0, 0, Math.PI / 2);
    liner(D - 2 * T, LH_IN, W / 2 - T - 0.01, LH_IN / 2, 0, 0, -Math.PI / 2);

    // filling: a soft bed plus instanced paper strands
    (function () {
      var iw = W - 2 * T - 0.2, id = D - 2 * T - 0.2;
      var bedG = new THREE.PlaneGeometry(iw, id, 30, 24);
      bedG.rotateX(-Math.PI / 2);
      var pos = bedG.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i);
        var e = Math.max(Math.abs(x) / (iw / 2), Math.abs(z) / (id / 2));
        pos.setY(i, Math.sin(x * 0.4) * Math.cos(z * 0.35) * 0.35 + Math.pow(e, 4) * 1.4);
      }
      bedG.computeVertexNormals();
      var bed = mesh(bedG, std({ color: '#8E6A45', roughness: 1, map: rep(texPaperC, 0.2, 0.2) }), false);
      bed.position.y = FILL - 0.8;
      hamper.add(bed);
      var count = small ? 900 : 2200, r = rng(7);
      // crinkle-cut paper: a thin strip folded into a zigzag along its length
      var sg = new THREE.PlaneGeometry(0.34, 3.6, 1, 12);
      sg.rotateX(-Math.PI / 2);
      (function () { var ps = sg.attributes.position; for (var v = 0; v < ps.count; v++) { var z = ps.getZ(v), step = Math.round((z + 1.8) / 0.3); ps.setY(v, (step % 2 ? 0.07 : -0.07) + Math.sin(z * 0.9) * 0.12); } sg.computeVertexNormals(); })();
      keep(sg);
      var inst = new THREE.InstancedMesh(sg, M.shred, count);
      var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e2 = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
      var base = [new THREE.Color('#A87C4F'), new THREE.Color('#C19A64'), new THREE.Color('#8F6740'), new THREE.Color('#E6DAC4')];
      for (var k = 0; k < count; k++) {
        var px = (r() - 0.5) * (iw - 2), pz = (r() - 0.5) * (id - 2);
        var edge = Math.max(Math.abs(px) / (iw / 2), Math.abs(pz) / (id / 2));
        p.set(px, FILL - 0.5 + r() * 1.1 + Math.pow(edge, 4) * 1.3, pz);
        e2.set((r() - 0.5) * 0.7, r() * Math.PI, (r() - 0.5) * 0.6);
        q.setFromEuler(e2); m4.compose(p, q, sc); inst.setMatrixAt(k, m4);
        col.copy(base[k % 4]).offsetHSL(0, (r() - 0.5) * 0.05, (r() - 0.5) * 0.1); inst.setColorAt(k, col);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.receiveShadow = true; inst.castShadow = !small;
      hamper.add(inst);
      disposables.push({ dispose: function () { inst.dispose(); } });
    })();

    /* lid with foil logo */
    var lid = new THREE.Group();
    var LW = W + 0.9, LD = D + 0.9;
    panel(LW, 0.55, LD, 0, LH - 0.275, 0, M.boxOut, lid, 0, 0.26);
    panel(LW, LH, 0.45, 0, LH / 2, LD / 2 - 0.22, M.boxOut, lid, 0, 0.2);
    panel(LW, LH, 0.45, 0, LH / 2, -LD / 2 + 0.22, M.boxOut, lid, 0, 0.2);
    panel(LD - 0.6, LH, 0.45, -LW / 2 + 0.22, LH / 2, 0, M.boxOut, lid, Math.PI / 2, 0.2);
    panel(LD - 0.6, LH, 0.45, LW / 2 - 0.22, LH / 2, 0, M.boxOut, lid, Math.PI / 2, 0.2);
    liner(LW - 0.9, LD - 0.9, 0, LH - 0.56, 0, Math.PI / 2, 0, lid);
    var logoTex = logoTexture(opts.logoSrc || 'img/kore-logo.png');
    var logo = labelPlane(logoTex, 19, 19 * 544 / 2934, { metal: 0.55, rough: 0.35 });
    // a soft self-glow keeps the fine gold strokes readable on the dark lid
    logo.material.emissive = new THREE.Color('#C9A45E');
    logo.material.emissiveMap = logoTex;
    logo.material.emissiveIntensity = 0.32;
    logo.rotation.x = -Math.PI / 2;
    logo.position.set(LW * 0.13, LH + 0.02, LD * 0.09);
    lid.add(logo);
    hamper.add(lid);
    var LID_CLOSED = new THREE.Vector3(0, H - LH * 0.82, 0);
    var LID_LIFT = new THREE.Vector3(0, H + 9, 2);
    var lidOpenQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.32, 0, 0.06));
    var LID_OPEN = (function () {
      lid.position.set(0, 0, 0); lid.quaternion.copy(lidOpenQ); lid.updateMatrixWorld(true);
      var bb = new THREE.Box3().setFromObject(lid);
      lid.quaternion.identity();
      return new THREE.Vector3(1.5, -bb.min.y + 0.05, -(D / 2 + 1.2) - bb.max.z);
    })();
    var qIdentity = new THREE.Quaternion();

    /* ribbon: a cross on the lid and bands down each side */
    var RB = 3;
    var RX = -LW * 0.3, RZ = -LD * 0.24; // the ribbon crosses off-centre, clear of the logo
    var ribbon = new THREE.Group();
    hamper.add(ribbon);
    var bandTopX = mesh(new THREE.BoxGeometry(LW + 0.12, 0.1, RB), M.ribbon); // across width
    var bandTopZ = mesh(new THREE.BoxGeometry(RB, 0.1, LD + 0.12), M.ribbon); // across depth
    var sideH = H + 0.3;
    function sideBand(axis, sign) {
      var g = new THREE.Group();
      var geo = axis === 'z' ? new THREE.BoxGeometry(RB, sideH, 0.1) : new THREE.BoxGeometry(0.1, sideH, RB);
      var m = mesh(geo, M.ribbon);
      m.position.y = sideH / 2;
      g.add(m);
      if (axis === 'z') g.position.set(RX, 0, sign * (LD / 2 + 0.07)); else g.position.set(sign * (LW / 2 + 0.07), 0, RZ);
      g.userData = { axis: axis, sign: sign };
      ribbon.add(g);
      return g;
    }
    var sides = [sideBand('z', 1), sideBand('z', -1), sideBand('x', 1), sideBand('x', -1)];
    var topY = H + 0.75;
    bandTopX.position.set(0, topY, RZ); bandTopZ.position.set(RX, topY, 0);
    ribbon.add(bandTopX); ribbon.add(bandTopZ);

    /* bow */
    // a flat satin band swept along a curve; sideAt(t, tangent) gives the band's width direction
    function strip(points, width, sideAt, closed, segs) {
      var curve = new THREE.CatmullRomCurve3(points, !!closed, 'centripetal');
      var n = segs || 64, pos = [], uv = [], idx = [], len = curve.getLength(), across = 4;
      for (var i = 0; i <= n; i++) {
        var t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t), sd = sideAt(t, tg).normalize();
        var nrm = new THREE.Vector3().crossVectors(tg, sd).normalize();
        for (var k = 0; k <= across; k++) {
          var a = k / across - 0.5, cup = (a * a - 0.08) * width * 0.18; // slight cupping across the ribbon
          pos.push(p.x + sd.x * a * width + nrm.x * cup, p.y + sd.y * a * width + nrm.y * cup, p.z + sd.z * a * width + nrm.z * cup);
          uv.push(k / across * width, t * len);
        }
      }
      for (i = 0; i < n; i++) for (k = 0; k < across; k++) {
        var aI = i * (across + 1) + k, bI = aI + across + 1;
        idx.push(aI, bI, aI + 1, aI + 1, bI, bI + 1);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    }
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var bow = new THREE.Group();
    var loops = [];
    var zSide = function () { return V(0, 0, 1); };
    [-1, 1].forEach(function (s) {
      var lp = mesh(strip([V(0, 0.45, 0), V(s * 1.6, 1.9, -0.2), V(s * 3.6, 2.6, -0.35), V(s * 5.1, 1.7, -0.3), V(s * 4.7, 0.45, -0.1), V(s * 2.6, 0.2, 0.1), V(0, 0.3, 0)], 2.3, zSide, false, 48), M.ribbon);
      lp.rotation.x = -0.35;
      lp.userData.side = s;
      bow.add(lp); loops.push(lp);
      var tail = mesh(strip([V(s * 0.3, 0.3, 0.4), V(s * 1.2, 0.18, 2.0), V(s * 2.2, 0.08, 3.9), V(s * 3.1, 0.04, 5.6)], 2.0, function (t, tg) { return new THREE.Vector3().crossVectors(tg, V(0, 1, 0)); }, false, 24), M.ribbon);
      bow.add(tail);
    });
    var knot = mesh(strip([V(0, 1.15, 0), V(0, 0.55, 0.85), V(0, -0.05, 0), V(0, 0.55, -0.85)], 1.7, function () { return V(1, 0, 0); }, true, 32), M.ribbon);
    knot.position.y = 0.2; bow.add(knot);
    bow.scale.setScalar(1.25);
    hamper.add(bow);
    var BOW_ON = new THREE.Vector3(RX, topY + 0.05, RZ);
    var BOW_REST = new THREE.Vector3(W / 2 + 9, 0.35, D / 2 + 3);
    var bowRestQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, -0.7, 0));

    /* tissue sheets, hinged at the side walls */
    function tissueSheet(sign) {
      var w = W / 2 + 1.5, d = D - 2 * T + 0.4;
      var g = new THREE.PlaneGeometry(w, d, small ? 22 : 40, small ? 16 : 30);
      g.rotateX(-Math.PI / 2);
      g.translate(-sign * w / 2, 0, 0); // hinge edge at local x=0
      var pos = g.attributes.position, rr = rng(sign > 0 ? 17 : 29), waves = [];
      for (var q = 0; q < 7; q++) waves.push({ fx: (rr() - 0.5) * 1.4, fz: (rr() - 0.5) * 1.4, ph: rr() * 6.28, a: 0.06 + rr() * 0.12 });
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i), ax = Math.abs(x), y = 0;
        // soft billows plus sharp creases, growing toward the free edge, like handled tissue
        y += Math.sin(z * 0.45 + x * 0.25) * 0.3 + Math.sin(ax * 0.8) * 0.2;
        waves.forEach(function (wv) { var v = Math.sin(x * wv.fx * 3 + z * wv.fz * 3 + wv.ph); y += (1 - Math.abs(v)) * wv.a * (0.4 + ax / w); });
        // an uneven, slightly ragged free edge
        if (ax > w - 1.2) pos.setX(i, x - sign * -1 * 0 + (Math.sin(z * 1.7) * 0.5 + Math.sin(z * 4.1) * 0.25) * -sign);
        pos.setY(i, y + ax * 0.02);
      }
      g.computeVertexNormals();
      var m = mesh(g, M.tissue, true);
      var pivot = new THREE.Group();
      pivot.position.set(sign * (W / 2 - T), H - 0.6, 0);
      pivot.add(m);
      hamper.add(pivot);
      return pivot;
    }
    var tissueL = tissueSheet(-1), tissueR = tissueSheet(1);

    /* ---------- products ---------- */
    function centred(group, h) { var wrap = new THREE.Group(); group.position.y = -h / 2; wrap.add(group); return wrap; }

    function makeBottle() {
      var g = new THREE.Group(), pts = [];
      [[0, 0], [3.2, 0], [3.6, 0.5], [3.6, 18.6], [3.35, 20.2], [2.3, 21.8], [1.75, 22.5], [1.75, 23.1], [0, 23.1]].forEach(function (p) { pts.push(new THREE.Vector2(p[0], p[1])); });
      g.add(mesh(new THREE.LatheGeometry(pts, small ? 48 : 96), M.bottle));
      var cap = mesh(new THREE.CylinderGeometry(1.95, 1.98, 3, 48), M.steelDark); cap.position.y = 24.4; g.add(cap);
      var capTop = mesh(new THREE.TorusGeometry(1.8, 0.16, 10, 48), M.steelDark); capTop.rotation.x = Math.PI / 2; capTop.position.y = 25.85; g.add(capTop);
      var collar = mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.35, 48), M.gold); collar.position.y = 22.95; g.add(collar);
      var band = mesh(new THREE.CylinderGeometry(3.62, 3.62, 0.5, 48, 1, true), M.gold); band.position.y = 3; g.add(band);
      var engr = new THREE.Mesh(keep(new THREE.CylinderGeometry(3.63, 3.63, 4, 32, 1, true, -0.75, 1.5)), std({ map: labelTexture([SAMPLE.bottle], { aspect: 3.6 / 4 * 1.5, colour: '#D8D4CB', font: "'Cormorant', Georgia, serif", size: 0.5 }), transparent: true, opacity: 0, roughness: 0.34, metalness: 0.95, depthWrite: false, envMapIntensity: 1.4 }));
      engr.position.y = 12; engr.renderOrder = 2; g.add(engr);
      var c = centred(g, 25.9);
      c.userData.engrave = engr;
      return c;
    }
    function makeNotebook() {
      var g = new THREE.Group(), w = 15, h = 21, th = 2;
      var back = mesh(roundGeo(w, h, 0.24, 0.1), M.notebook); back.position.set(0, h / 2, -th / 2 + 0.12); g.add(back);
      var pages = mesh(new THREE.BoxGeometry(w - 0.6, h - 0.6, th - 0.44), M.pages); pages.position.set(0.25, h / 2, 0); g.add(pages);
      var spine = mesh(new THREE.CylinderGeometry(th / 2, th / 2, h - 0.1, 24, 1, false, Math.PI, Math.PI), M.notebook); spine.position.set(-w / 2 + 0.3, h / 2, 0); g.add(spine);
      var hinge = new THREE.Group(); hinge.position.set(-w / 2 + 0.3, 0, th / 2 - 0.11);
      var cover = mesh(roundGeo(w - 0.3, h, 0.24, 0.1), M.notebook); cover.position.set((w - 0.3) / 2, h / 2, 0); hinge.add(cover);
      var foil = labelPlane(labelTexture([SAMPLE.notebook], { aspect: 1.4, colour: '#D3B26A', size: 0.55 }), 7, 5, { metal: 0.85, rough: 0.3 });
      foil.position.set((w - 0.3) / 2, h * 0.58, 0.12); hinge.add(foil);
      var elastic = mesh(new THREE.BoxGeometry(0.35, h + 0.02, th + 0.1), std({ color: '#1d1a17', roughness: 0.6 })); elastic.position.set(w * 0.38, h / 2, 0); g.add(elastic);
      g.add(hinge);
      var c = centred(g, h);
      c.userData.cover = hinge; c.userData.elastic = elastic;
      return c;
    }
    function makeMug() {
      var g = new THREE.Group(), pts = [];
      [[0, 0.01], [3.6, 0.01], [3.95, 0.12], [4.15, 0.45], [4.22, 1.2], [4.25, 9.2], [4.2, 9.45], [4.06, 9.56], [3.92, 9.45], [3.86, 9.1], [3.82, 1.4], [3.5, 1.25], [0, 1.22]].forEach(function (p) { pts.push(new THREE.Vector2(p[0], p[1])); });
      g.add(mesh(new THREE.LatheGeometry(pts, small ? 48 : 96), M.mug));
      var handle = mesh(new THREE.TorusGeometry(2.4, 0.52, 20, 40, Math.PI), M.mug); handle.position.set(4.1, 5, 0); handle.rotation.z = -Math.PI / 2; g.add(handle);
      var print = new THREE.Mesh(keep(new THREE.CylinderGeometry(4.27, 4.27, 3.6, 32, 1, true, -0.85, 1.7)), std({ map: labelTexture([SAMPLE.mug], { aspect: 4.27 * 1.7 / 3.6, colour: hex('terracotta', '#A8562E'), font: "'Cormorant', Georgia, serif", size: 0.4 }), transparent: true, roughness: 0.3, depthWrite: false }));
      print.position.y = 5; print.renderOrder = 2; g.add(print);
      return centred(g, 9.5);
    }
    function makePen() {
      var g = new THREE.Group();
      var body = mesh(new THREE.CylinderGeometry(0.55, 0.5, 12, 40), M.steelDark); body.position.y = 6; g.add(body);
      var tip = mesh(new THREE.ConeGeometry(0.55, 1.6, 24), M.gold); tip.rotation.x = Math.PI; tip.position.y = -0.8; g.add(tip);
      var cap = mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.5, 24), M.gold); cap.position.y = 12.25; g.add(cap);
      var clip = mesh(new THREE.BoxGeometry(0.22, 4.2, 0.2), M.gold); clip.position.set(0, 10, 0.62); g.add(clip);
      var engr = labelPlane(labelTexture([SAMPLE.pen], { aspect: 5, colour: '#D3B26A', font: "'Manrope', sans-serif", size: 0.45, weight: '600' }), 5, 1, { metal: 0.8, rough: 0.3 });
      engr.rotation.z = Math.PI / 2; engr.position.set(0, 5.5, 0.56); g.add(engr);
      return centred(g, 12.5);
    }
    function makeChocolates() {
      var g = new THREE.Group();
      var box = mesh(roundGeo(16, 4, 10, 0.18), M.choc); box.position.y = 2; g.add(box);
      var sleeve = mesh(roundGeo(5.6, 4.08, 10.08, 0.12), M.chocSleeve); sleeve.position.y = 2; g.add(sleeve);
      return g;
    }
    function makeCandle() {
      var g = new THREE.Group();
      var glass = new THREE.Mesh(keep(new THREE.CylinderGeometry(4, 4, 9, 40, 1, true)), M.glass); glass.position.y = 4.5; glass.renderOrder = 3; g.add(glass);
      var wax = mesh(new THREE.CylinderGeometry(3.8, 3.8, 7.2, 40), M.candleWax); wax.position.y = 3.6; g.add(wax);
      var wick = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), M.steelDark); wick.position.y = 7.7; g.add(wick);
      var lbl = new THREE.Mesh(keep(new THREE.CylinderGeometry(4.02, 4.02, 3.2, 32, 1, true, -0.7, 1.4)), std({ color: '#F7F2E9', roughness: 0.8 }));
      lbl.position.y = 4; g.add(lbl);
      return g;
    }

    var products = {
      bottle: { obj: makeBottle(), home: new THREE.Vector3(-5, FILL + 2.7, -9.6), homeRot: new THREE.Euler(0, 0, Math.PI / 2), h: 25.9 },
      notebook: { obj: makeNotebook(), home: new THREE.Vector3(11.4, FILL + 1.1, 3.8), homeRot: new THREE.Euler(-Math.PI / 2, 0, 0.04), h: 21 },
      mug: { obj: makeMug(), home: new THREE.Vector3(-14.3, FILL + 4.0, 8.5), homeRot: new THREE.Euler(0, 2.2, 0), h: 9.5 },
      pen: { obj: makePen(), home: new THREE.Vector3(2.6, FILL + 0.9, 4.2), homeRot: new THREE.Euler(Math.PI / 2, 0, 0.05), h: 12.5 }
    };
    Object.keys(products).forEach(function (k) { hamper.add(products[k].obj); });
    var choc = makeChocolates(); choc.position.set(-4.2, FILL - 0.4, 4.6); choc.rotation.y = Math.PI / 2 + 0.03; hamper.add(choc);
    var candle = makeCandle(); candle.position.set(-14.3, FILL - 0.6, -1.4); hamper.add(candle);
    var CHOC_HOME = choc.position.clone(), CANDLE_HOME = candle.position.clone();

    /* ---------- framing ---------- */
    var portrait = false;
    var CAM = [
      { p: 0.0, pos: [0, 55, 162], tgt: [0, 33, 0], bg: '#15120F' },
      { p: 0.1, pos: [-8, 46, 124], tgt: [0, 24, 0], bg: '#15120F' },
      { p: 0.2, pos: [-14, 40, 84], tgt: [2, 13, -2], bg: '#16130F' },
      { p: 0.3, pos: [-10, 54, 72], tgt: [4, 8, -1], bg: '#17130F' },
      { p: 0.37, pos: [-2, 66, 54], tgt: [6, 5, 0], bg: '#18140F' },
      { p: 0.43, pos: [16, 32, 80], tgt: [6, 19, 10], bg: '#111513' },
      { p: 0.5, pos: [18, 32, 78], tgt: [6, 19, 10], bg: '#111513' },
      { p: 0.57, pos: [16, 34, 78], tgt: [6, 19, 10], bg: '#171011' },
      { p: 0.64, pos: [18, 34, 76], tgt: [6, 19, 10], bg: '#171011' },
      { p: 0.71, pos: [12, 30, 70], tgt: [5, 18, 11], bg: '#15120F' },
      { p: 0.78, pos: [14, 30, 68], tgt: [5, 18, 11], bg: '#15120F' },
      { p: 0.83, pos: [8, 32, 58], tgt: [5, 16, 12], bg: '#14120F' },
      { p: 0.89, pos: [10, 33, 58], tgt: [5, 16, 12], bg: '#14120F' },
      { p: 1.0, pos: [-16, 54, 92], tgt: [12, 10, -4], bg: '#15120F' }
    ];
    var FOCUS = { bottle: [-9, 20, 18], notebook: [-9, 20, 16], mug: [-9, 18, 18], pen: [-7, 19, 22] };
    var FOCUS_PORTRAIT = { bottle: [0, 24, 16], notebook: [0, 24, 14], mug: [0, 22, 16], pen: [0, 22, 20] };

    function camAt(p) {
      var i = 0;
      while (i < CAM.length - 2 && p > CAM[i + 1].p) i++;
      var a = CAM[i], b = CAM[i + 1];
      var t = ease(clamp((p - a.p) / (b.p - a.p), 0, 1));
      var pos = [mix(a.pos[0], b.pos[0], t), mix(a.pos[1], b.pos[1], t), mix(a.pos[2], b.pos[2], t)];
      var tgt = [mix(a.tgt[0], b.tgt[0], t), mix(a.tgt[1], b.tgt[1], t), mix(a.tgt[2], b.tgt[2], t)];
      if (portrait) {
        // taller, narrower frame: step back and centre the focus
        var k = 1.75;
        pos = [pos[0] * 0.6, tgt[1] + (pos[1] - tgt[1]) * k, tgt[2] + (pos[2] - tgt[2]) * k];
        tgt = [tgt[0] * 0.2, tgt[1] + 2, tgt[2]];
      }
      return { pos: pos, tgt: tgt, bg: lerpColour(a.bg, b.bg, t) };
    }
    function lerpColour(a, b, t) {
      var ca = new THREE.Color(a), cb = new THREE.Color(b);
      return '#' + ca.lerp(cb, t).getHexString();
    }

    /* ---------- pose everything for progress p ---------- */
    var tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
    var current = -1, override = null;

    function productPose(key, p) {
      var P = products[key], tl = TIMELINE.products.filter(function (x) { return x.key === key; })[0];
      var up = seg(p, tl.rise), down = seg(p, tl.back);
      var u = down > 0 ? 1 - down : up; // 0 = in the box, 1 = presented
      var f = (portrait ? FOCUS_PORTRAIT : FOCUS)[key];
      var focus = new THREE.Vector3(f[0], f[1], f[2]);
      var lift = new THREE.Vector3(P.home.x, H + P.h * 0.55 + 4, P.home.z);
      var a = smooth(clamp(u / 0.4, 0, 1)), b = ease(clamp((u - 0.3) / 0.7, 0, 1));
      P.obj.position.copy(P.home).lerp(lift, a).lerp(focus, b);
      // orientation: from its resting pose to a presentation pose, plus a slow turn while presented
      var showT = clamp((p - tl.rise[1]) / (tl.back[0] - tl.rise[1]), 0, 1);
      var restQ = new THREE.Quaternion().setFromEuler(P.homeRot);
      var presentE;
      if (key === 'bottle') presentE = new THREE.Euler(0.05, -0.9 + showT * 1.1, -0.04);
      else if (key === 'notebook') presentE = new THREE.Euler(-0.08, 0.5 - showT * 0.25, 0.02);
      else if (key === 'mug') presentE = new THREE.Euler(0.12, 1.6 - showT * 1.25, 0);
      else presentE = new THREE.Euler(0.15, -0.3 + showT * 0.6, Math.PI / 2 - 0.12);
      var presQ = new THREE.Quaternion().setFromEuler(presentE);
      P.obj.quaternion.copy(restQ).slerp(presQ, ease(u));
      if (key === 'bottle') P.obj.userData.engrave.material.opacity = ease(clamp((p - tl.rise[1] + 0.01) / 0.03, 0, 1)) * (1 - down);
      if (key === 'notebook') {
        var open = ease(clamp((p - tl.rise[1] - 0.01) / 0.04, 0, 1)) * (1 - ease(clamp(down * 1.5, 0, 1)));
        P.obj.userData.cover.rotation.y = -open * 0.72;
        P.obj.userData.elastic.visible = open < 0.05;
      }
      return u;
    }

    function pose(p) {
      p = clamp(p, 0, 1);
      // ribbon: side bands fall open and fade, top bands slide off
      var un = ease(seg(p, TIMELINE.untie));
      sides.forEach(function (s) {
        var ang = un * 1.2;
        if (s.userData.axis === 'z') s.rotation.x = s.userData.sign * ang; else s.rotation.z = -s.userData.sign * ang;
        s.position.y = -un * 0.6;
      });
      bandTopX.scale.x = 1 - un * 0.98; bandTopX.position.x = un * (LW / 2);
      bandTopZ.scale.z = 1 - un * 0.98; bandTopZ.position.z = -un * (LD / 2);
      bandTopX.position.z = RZ; bandTopZ.position.x = RX;
      M.ribbon.opacity = 1 - smooth(clamp((un - 0.55) / 0.45, 0, 1));
      ribbon.visible = un < 0.999;
      bandTopX.position.y = topY; bandTopZ.position.y = topY;
      // bow: loosens, lifts away and comes to rest on the table
      var bw = seg(p, TIMELINE.bow), loose = ease(clamp(bw / 0.35, 0, 1)), move = ease(clamp((bw - 0.25) / 0.75, 0, 1));
      loops.forEach(function (lp) { lp.rotation.y = lp.userData.side * loose * 0.45; lp.rotation.x = -0.35 - loose * 0.5; lp.scale.set(1, 1 - loose * 0.25, 1); });
      bow.position.copy(BOW_ON).lerp(BOW_REST, move);
      bow.position.y += Math.sin(move * Math.PI) * 8;
      bow.quaternion.copy(qIdentity).slerp(bowRestQ, move);
      M.ribbon.opacity = Math.max(M.ribbon.opacity, 0);
      // the bow keeps full opacity: it is a separate material instance
      // lid: lift, then swing back and lean behind the box
      var lift = ease(seg(p, TIMELINE.lidLift)), open = ease(seg(p, TIMELINE.lidOpen));
      lid.position.copy(LID_CLOSED).lerp(LID_LIFT, lift);
      if (open > 0) { lid.position.lerp(LID_OPEN, open); lid.position.y += Math.sin(open * Math.PI) * 4; }
      lid.quaternion.copy(qIdentity).slerp(lidOpenQ, open);
      // tissue: folds out over the walls
      var ti = ease(seg(p, TIMELINE.tissue));
      tissueL.rotation.z = ti * 2.55;
      tissueR.rotation.z = -ti * 2.55;
      tissueL.scale.y = tissueR.scale.y = 0.2 + 0.8 * smooth(clamp(ti * 3, 0, 1)); // lies flat under the closed lid
      warm.intensity = ease(seg(p, TIMELINE.warm)) * 1.1 * (1 - ease(seg(p, [0.92, 1])) * 0.4);
      // products
      Object.keys(products).forEach(function (k) { productPose(k, p); });
      // accessories lift gently while the pen is presented
      var acc = seg(p, TIMELINE.accessories), accLift = Math.sin(acc * Math.PI);
      choc.position.copy(CHOC_HOME); choc.position.y += accLift * 3.2; choc.rotation.x = -accLift * 0.25;
      candle.position.copy(CANDLE_HOME); candle.position.y += accLift * 3.6;
      // camera
      var c = override || camAt(p);
      camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
      camera.lookAt(c.tgt[0], c.tgt[1], c.tgt[2]);
      return c;
    }
    // the bow must not fade with the ribbon bands
    var bowMat = M.ribbon.clone(); bowMat.transparent = false; keep(bowMat);
    bow.traverse(function (o) { if (o.isMesh) o.material = bowMat; });

    var width = 0, height = 0;
    function resize() {
      var w = container.clientWidth || 800, h = container.clientHeight || 600;
      if (w === width && h === height) return false;
      width = w; height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      portrait = camera.aspect < 0.9;
      camera.fov = portrait ? 34 : 30;
      camera.updateProjectionMatrix();
      return true;
    }

    var lastBg = null;
    function render(p) {
      var c = pose(p);
      renderer.render(scene, camera);
      if (c.bg !== lastBg) { lastBg = c.bg; if (opts.onBackground) opts.onBackground(c.bg); }
    }

    var api = {
      TIMELINE: TIMELINE,
      SAMPLE: SAMPLE,
      setProgress: function (p) {
        var changed = resize();
        if (!changed && Math.abs(p - current) < 0.00005) return;
        current = p;
        render(p);
      },
      resize: function () { if (resize() && current >= 0) render(current); },
      /* 'low' drops shadows and pixel density for slower devices */
      setQuality: function (q) {
        if (q !== 'low') return;
        renderer.setPixelRatio(1);
        renderer.shadowMap.enabled = false;
        key.castShadow = false;
        scene.traverse(function (o) { if (o.material) [].concat(o.material).forEach(function (m) { m.needsUpdate = true; }); });
        width = 0; resize();
        if (current >= 0) render(current);
      },
      /* Render one frame for stills and close-ups. camera: {pos, tgt} overrides the film camera. */
      still: function (p, cam, explode) {
        resize();
        override = cam && !cam.follow ? { pos: cam.pos, tgt: cam.tgt, bg: null } : null;
        pose(p);
        if (cam && cam.follow) {
          var o = products[cam.follow].obj;
          o.updateMatrixWorld(true);
          var bb = new THREE.Box3().setFromObject(o), ctr = bb.getCenter(new THREE.Vector3());
          ctr.y += cam.dy || 0;
          var fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
          fwd.y = 0; fwd.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), cam.yaw || 0);
          var eye = ctr.clone().add(fwd.multiplyScalar(cam.dist || 16)); eye.y += cam.up || 0;
          camera.position.copy(eye); camera.lookAt(ctr);
        }
        if (explode) {
          var spots = { bottle: [-15, 26, -2], notebook: [12, 27, -4], mug: [-4, 24, 10], pen: [8, 22, 12] };
          Object.keys(spots).forEach(function (k) {
            var o = products[k].obj; o.position.set(spots[k][0], spots[k][1], spots[k][2]);
            o.quaternion.setFromEuler(k === 'pen' ? new THREE.Euler(0.3, 0.2, Math.PI / 2 - 0.3) : (k === 'notebook' ? new THREE.Euler(-0.15, 0.35, 0.05) : new THREE.Euler(0.08, k === 'mug' ? 1.4 : -0.4, 0)));
          });
          choc.position.set(-4, 17, 0); choc.rotation.set(-0.3, 0.4, 0);
          candle.position.set(15, 16, 8); candle.rotation.set(0, 0, 0);
        }
        renderer.render(scene, camera);
        override = null;
        var url = canvas.toDataURL('image/png');
        current = -1;
        return url;
      },
      canvas: canvas,
      logoReady: function () { return logoReady || Promise.resolve(false); },
      destroy: function () {
        disposables.forEach(function (d) { try { d.dispose(); } catch (e) { /* ignore */ } });
        scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); if (opts.onError) opts.onError(new Error('Graphics context lost')); });
    resize();
    return api;
  }

  root.KoreHomeScene = { create: create, TIMELINE: TIMELINE, SAMPLE: SAMPLE };
})(typeof self !== 'undefined' ? self : this);
