/*
 * KORE hamper live preview.
 *
 * KorePreview.create(element, { renderer, catalogue }) returns a renderer with:
 *   render(config, catalogue, ctx)   draw the current configuration
 *   setView('front'|'side'|'top'|'inside'), zoomBy(factor), toggleLid(),
 *   resetView(), destroy()
 *
 * The built-in renderer ('css') builds a real 3D box out of CSS-transformed
 * faces, with product drawings standing in the filling. It needs no external
 * models.
 *
 * GLB/glTF later: register another renderer with the same methods, e.g.
 *   KorePreview.registerRenderer('glb', {
 *     isSupported: function (catalogue) { return !!window.THREE && catalogue.boxes.every(b => b.model); },
 *     create: function (el, opts) { return new MyThreeRenderer(el, opts); }
 *   });
 * and pass { renderer: 'glb' } to create(). The page falls back to 'css'
 * automatically when isSupported() returns false (no WebGL, missing models).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KorePreview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hexToRgb(hex) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) {
    var rgb = hexToRgb(hex).map(function (v) {
      return Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    });
    return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  function lum(hex) {
    var c = hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function onColour(hex) { return lum(hex) > 0.4 ? '#211D19' : '#F7F2E9'; }
  function n2(v) { return Math.round(v * 100) / 100; }

  /* ---------- product and option drawings ----------
   * Each entry: [viewBoxWidth, viewBoxHeight, drawFn(c, d, l)] where c is the
   * main colour, d a darker shade and l a lighter shade. */
  var ICONS = {
    bottle: [40, 140, function (c, d, l) { return '<rect x="13" y="2" width="14" height="14" rx="3" fill="' + d + '"/><rect x="11" y="14" width="18" height="8" rx="2" fill="' + shade(d, -0.2) + '"/><rect x="4" y="22" width="32" height="116" rx="11" fill="' + c + '"/><rect x="9" y="30" width="5" height="96" rx="2.5" fill="' + l + '" opacity=".55"/>'; }],
    flask: [40, 130, function (c, d, l) { return '<rect x="7" y="2" width="26" height="22" rx="5" fill="' + d + '"/><rect x="6" y="24" width="28" height="104" rx="8" fill="' + c + '"/><rect x="6" y="24" width="28" height="5" fill="' + shade(d, -0.15) + '"/><rect x="10" y="34" width="4" height="84" rx="2" fill="' + l + '" opacity=".55"/>'; }],
    mug: [120, 100, function (c, d, l) { return '<path d="M86 30h12a16 16 0 0 1 0 32H86" fill="none" stroke="' + d + '" stroke-width="9"/><rect x="8" y="8" width="82" height="88" rx="10" fill="' + c + '"/><ellipse cx="49" cy="11" rx="38" ry="5" fill="' + d + '"/><rect x="16" y="20" width="7" height="64" rx="3.5" fill="' + l + '" opacity=".5"/>'; }],
    travelmug: [50, 95, function (c, d, l) { return '<rect x="5" y="2" width="40" height="16" rx="5" fill="' + shade(d, -0.25) + '"/><path d="M6 18h38l-5 75H11z" fill="' + c + '"/><rect x="11" y="44" width="28" height="12" fill="' + d + '"/><rect x="12" y="24" width="4" height="60" rx="2" fill="' + l + '" opacity=".5"/>'; }],
    tumbler: [50, 90, function (c, d, l) { return '<rect x="3" y="2" width="44" height="10" rx="4" fill="' + shade(d, -0.2) + '"/><path d="M5 12h40l-6 76H11z" fill="' + c + '"/><rect x="11" y="18" width="4" height="62" rx="2" fill="' + l + '" opacity=".55"/>'; }],
    notebook: [75, 105, function (c, d, l) { return '<rect x="6" y="3" width="66" height="99" rx="3" fill="' + shade(l, 0.5) + '"/><rect x="3" y="2" width="66" height="100" rx="3" fill="' + c + '"/><rect x="3" y="2" width="8" height="100" fill="' + d + '"/><rect x="58" y="2" width="4" height="100" fill="' + d + '" opacity=".7"/>'; }],
    journal: [70, 100, function (c, d, l) { return '<rect x="3" y="2" width="64" height="96" rx="6" fill="' + c + '"/><rect x="3" y="2" width="9" height="96" rx="4" fill="' + d + '"/><rect x="52" y="2" width="5" height="96" fill="' + shade(d, -0.3) + '"/><rect x="14" y="10" width="34" height="2" fill="' + l + '" opacity=".35"/>'; }],
    pen: [10, 90, function (c, d, l) { return '<rect x="2" y="0" width="6" height="12" rx="2" fill="' + d + '"/><rect x="7" y="4" width="2" height="22" rx="1" fill="#C4A15A"/><rect x="1.5" y="12" width="7" height="70" rx="3" fill="' + c + '"/><path d="M1.5 82h7L5 90z" fill="#8a8f94"/>'; }],
    penset: [36, 100, function (c, d) { return '<rect x="1" y="2" width="34" height="96" rx="5" fill="' + d + '"/><rect x="4" y="5" width="28" height="90" rx="3" fill="#EFE6D4"/><rect x="9" y="12" width="6" height="76" rx="3" fill="' + c + '"/><rect x="21" y="12" width="6" height="76" rx="3" fill="' + c + '"/><rect x="11" y="12" width="2" height="18" fill="#C4A15A"/><rect x="23" y="12" width="2" height="18" fill="#C4A15A"/>'; }],
    organiser: [110, 66, function (c, d, l) { return '<rect x="64" y="0" width="5" height="26" rx="2" fill="#26221F"/><rect x="74" y="4" width="5" height="22" rx="2" fill="#A8562E"/><rect x="2" y="22" width="106" height="42" rx="3" fill="' + c + '"/><rect x="2" y="22" width="106" height="6" fill="' + d + '"/><rect x="38" y="22" width="3" height="42" fill="' + d + '"/><rect x="58" y="22" width="3" height="42" fill="' + d + '"/><rect x="8" y="34" width="24" height="3" fill="' + l + '" opacity=".5"/>'; }],
    sticky: [60, 60, function (c, d, l) { return '<rect x="10" y="2" width="46" height="46" rx="2" fill="' + shade(c, 0.3) + '"/><rect x="6" y="7" width="46" height="46" rx="2" fill="' + l + '"/><rect x="2" y="12" width="46" height="46" rx="2" fill="' + c + '"/><rect x="2" y="12" width="46" height="8" fill="' + d + '" opacity=".35"/>'; }],
    planner: [75, 105, function (c, d, l) { return '<rect x="3" y="2" width="68" height="100" rx="3" fill="' + c + '"/><rect x="3" y="2" width="6" height="100" fill="' + d + '"/><rect x="20" y="30" width="38" height="26" rx="2" fill="' + l + '" opacity=".75"/>'; }],
    tote: [90, 100, function (c, d, l) { return '<path d="M26 34V22a19 19 0 0 1 38 0v12" fill="none" stroke="' + d + '" stroke-width="6"/><path d="M6 32h78l-4 66H10z" fill="' + c + '"/><path d="M6 32h78v8H6z" fill="' + d + '" opacity=".4"/><rect x="14" y="46" width="4" height="44" fill="' + l + '" opacity=".35"/>'; }],
    keychain: [30, 76, function (c, d) { return '<circle cx="15" cy="12" r="9" fill="none" stroke="#C4A15A" stroke-width="3.5"/><rect x="5" y="22" width="20" height="52" rx="6" fill="' + c + '"/><rect x="9" y="26" width="12" height="44" rx="4" fill="none" stroke="' + d + '" stroke-width="1.2" stroke-dasharray="2 2"/>'; }],
    bookmark: [22, 82, function (c, d, l) { return '<path d="M11 0v14" stroke="#A8562E" stroke-width="2"/><path d="M8 0h6l2 10H6z" fill="#A8562E"/><rect x="2" y="12" width="18" height="68" rx="2" fill="' + c + '"/><rect x="5" y="16" width="4" height="58" fill="' + l + '" opacity=".5"/><path d="M2 80h18l-9-8z" fill="' + d + '"/>'; }],
    tshirt: [110, 76, function (c, d, l) { return '<path d="M38 4h34l30 16-10 22-12-6v38H30V36l-12 6L8 20z" fill="' + c + '"/><path d="M42 4a13 10 0 0 0 26 0" fill="' + d + '"/><rect x="34" y="40" width="42" height="2" fill="' + l + '" opacity=".4"/>'; }],
    cap: [110, 66, function (c, d, l) { return '<path d="M14 50a41 41 0 0 1 82 0z" fill="' + c + '"/><path d="M55 9v41" stroke="' + d + '" stroke-width="1.5"/><circle cx="55" cy="10" r="3" fill="' + d + '"/><path d="M8 50h94c4 0 6 10-4 12H20C8 62 4 52 8 50z" fill="' + d + '"/><path d="M26 30a30 30 0 0 1 20-16" stroke="' + l + '" stroke-width="3" fill="none" opacity=".4"/>'; }],
    chocobox: [110, 70, function (c, d, l) { return '<rect x="2" y="10" width="106" height="58" rx="3" fill="#3B2418"/><rect x="2" y="10" width="106" height="20" fill="' + c + '"/><rect x="46" y="10" width="18" height="58" fill="' + c + '"/><rect x="2" y="10" width="106" height="3" fill="' + l + '" opacity=".5"/><circle cx="24" cy="48" r="8" fill="#5A3826"/><circle cx="86" cy="48" r="8" fill="#5A3826"/>'; }],
    cookiejar: [70, 90, function () { return '<rect x="14" y="2" width="42" height="14" rx="3" fill="#C49A6C"/><rect x="6" y="14" width="58" height="74" rx="10" fill="#E8F0F2" opacity=".85"/><circle cx="24" cy="40" r="10" fill="#D9A35F"/><circle cx="46" cy="52" r="10" fill="#C98F4E"/><circle cx="28" cy="68" r="10" fill="#D9A35F"/><circle cx="48" cy="30" r="8" fill="#C98F4E"/><rect x="12" y="20" width="4" height="60" rx="2" fill="#fff" opacity=".6"/>'; }],
    pouch: [70, 100, function () { return '<path d="M8 6h54l4 92H4z" fill="#C9B391"/><rect x="8" y="6" width="54" height="8" fill="#A8925F"/><rect x="16" y="34" width="38" height="36" rx="3" fill="#F7F2E9"/><rect x="22" y="44" width="26" height="3" fill="#A8562E"/><rect x="22" y="52" width="20" height="2" fill="#6B6055"/>'; }],
    teatin: [56, 80, function (c, d, l) { return '<rect x="3" y="2" width="50" height="14" rx="3" fill="' + d + '"/><rect x="5" y="14" width="46" height="64" rx="3" fill="' + c + '"/><rect x="12" y="32" width="32" height="26" rx="2" fill="#EFE6D4"/><rect x="8" y="18" width="4" height="56" fill="' + l + '" opacity=".4"/>'; }],
    coffeebag: [66, 106, function (c, d) { return '<path d="M6 16h54v88H6z" fill="' + c + '"/><path d="M6 4h54v14H6z" fill="' + d + '"/><path d="M6 16h54" stroke="' + shade(d, -0.3) + '" stroke-width="2"/><rect x="14" y="44" width="38" height="34" rx="3" fill="#F7F2E9"/><circle cx="33" cy="56" r="6" fill="#5A3826"/>'; }],
    tube: [26, 92, function () { return '<rect x="7" y="0" width="12" height="12" rx="2" fill="#A8562E"/><path d="M3 12h20l-2 78H5z" fill="#F4EEE4"/><rect x="5" y="88" width="16" height="4" fill="#D8CDBD"/><rect x="7" y="36" width="12" height="24" rx="2" fill="#B4C3A6"/>'; }],
    jar: [70, 60, function () { return '<rect x="8" y="2" width="54" height="16" rx="4" fill="#C4A15A"/><rect x="4" y="16" width="62" height="42" rx="8" fill="#F1ECE4"/><rect x="18" y="28" width="34" height="16" rx="2" fill="#E6C3BC"/><rect x="10" y="22" width="4" height="30" fill="#fff" opacity=".6"/>'; }],
    carekit: [110, 80, function (c, d, l) { return '<path d="M4 20c0-8 6-14 14-14h74c8 0 14 6 14 14v54H4z" fill="' + c + '"/><path d="M8 18h94" stroke="' + d + '" stroke-width="3" stroke-dasharray="4 2"/><circle cx="96" cy="18" r="4" fill="#C4A15A"/><rect x="12" y="30" width="40" height="3" fill="' + l + '" opacity=".5"/>'; }],
    candle: [60, 72, function (c, d, l) { return '<path d="M30 2v10" stroke="#26221F" stroke-width="2"/><rect x="4" y="12" width="52" height="58" rx="6" fill="#E9EEF0" opacity=".9"/><rect x="7" y="22" width="46" height="45" rx="4" fill="' + c + '"/><rect x="12" y="34" width="36" height="20" rx="2" fill="#F7F2E9"/><rect x="9" y="16" width="4" height="48" fill="#fff" opacity=".6"/>'; }],
    lanyard: [60, 120, function (c, d) { return '<path d="M12 2v60l18 18 18-18V2" fill="none" stroke="' + c + '" stroke-width="9"/><rect x="25" y="76" width="10" height="8" fill="#9aa0a5"/><rect x="10" y="84" width="40" height="34" rx="3" fill="#E9EEF0" opacity=".9"/><rect x="15" y="89" width="30" height="24" rx="2" fill="#F7F2E9"/>'; }],
    folder: [76, 106, function (c, d, l) { return '<rect x="2" y="2" width="72" height="102" rx="3" fill="' + c + '"/><path d="M2 70l72-14v48H2z" fill="' + d + '"/><rect x="12" y="16" width="40" height="3" fill="' + l + '" opacity=".5"/>'; }],
    usb: [22, 62, function (c, d) { return '<rect x="5" y="0" width="12" height="16" rx="1" fill="#C9CDD0"/><rect x="2" y="14" width="18" height="46" rx="5" fill="' + c + '"/><circle cx="11" cy="52" r="3" fill="' + d + '"/>'; }],
    kit: [76, 106, function (c, d) { return '<rect x="2" y="2" width="72" height="102" rx="3" fill="#F7F2E9"/><rect x="2" y="34" width="72" height="40" fill="' + c + '"/><rect x="54" y="8" width="6" height="90" rx="3" fill="' + d + '"/><rect x="10" y="12" width="36" height="4" fill="#A8562E"/>'; }],
    card: [70, 100, function (c, d) { return '<rect x="4" y="4" width="64" height="94" rx="2" fill="' + shade(c, -0.08) + '"/><rect x="2" y="2" width="64" height="94" rx="2" fill="' + c + '"/><rect x="14" y="40" width="40" height="2" fill="' + d + '" opacity=".4"/>'; }],
    coaster: [80, 80, function (c, d, l) { return '<circle cx="42" cy="44" r="34" fill="' + d + '"/><circle cx="38" cy="38" r="34" fill="' + c + '"/><circle cx="38" cy="38" r="26" fill="none" stroke="' + l + '" stroke-width="2" opacity=".6"/>'; }],
    frame: [76, 100, function (c, d) { return '<rect x="2" y="2" width="72" height="96" rx="2" fill="' + c + '"/><rect x="11" y="11" width="54" height="70" fill="#E9E2D3"/><path d="M11 70l16-18 12 12 10-8 16 14v11H11z" fill="#B4C3A6"/><rect x="11" y="83" width="54" height="9" fill="' + d + '" opacity=".25"/>'; }],
    diya: [90, 62, function (c, d) { return '<path d="M44 4c6 8 6 14 0 18-6-4-6-10 0-18z" fill="#E89B3C"/><path d="M4 30h82c-4 18-20 28-41 28S8 48 4 30z" fill="' + c + '"/><ellipse cx="45" cy="30" rx="41" ry="7" fill="' + d + '"/>'; }],
    keepsake: [100, 66, function (c, d, l) { return '<rect x="4" y="22" width="92" height="42" rx="3" fill="' + c + '"/><rect x="2" y="8" width="96" height="18" rx="3" fill="' + d + '"/><rect x="44" y="22" width="12" height="8" fill="#C4A15A"/><rect x="10" y="36" width="40" height="2" fill="' + l + '" opacity=".4"/>'; }],
    /* finishing icons (used on option cards) */
    ribbon: [100, 100, function (c, d) { return '<rect x="0" y="40" width="100" height="16" fill="' + c + '"/><rect x="42" y="0" width="16" height="100" fill="' + c + '"/><rect x="0" y="40" width="100" height="3" fill="' + d + '" opacity=".5"/>'; }],
    bow: [100, 70, function (c, d) { return '<path d="M50 34C30 4 4 8 8 30s30 18 42 4zM50 34c20-30 46-26 42-4S62 48 50 34z" fill="' + c + '"/><path d="M46 38l-14 30h10l8-18 8 18h10L54 38z" fill="' + d + '"/><circle cx="50" cy="35" r="7" fill="' + d + '"/>'; }],
    wrap: [100, 100, function (c) { return '<rect x="6" y="20" width="88" height="74" rx="3" fill="#E9E2D3"/><path d="M6 20l44 30 44-30" fill="none" stroke="#B48A5A" stroke-width="2"/><path d="M20 40h10M60 70h12M30 80h8M70 36h8" stroke="#A8562E" stroke-width="3" stroke-linecap="round"/>'; }],
    clearwrap: [100, 100, function () { return '<path d="M16 30h68l-6 64H22z" fill="#DCE8EE" opacity=".7" stroke="#9FB6C2"/><path d="M36 30c4-14 24-14 28 0" fill="none" stroke="#9FB6C2" stroke-width="2"/><path d="M44 14l6 10 6-10" fill="none" stroke="#A8562E" stroke-width="3"/>'; }],
    tag: [60, 100, function () { return '<path d="M30 0v20" stroke="#6B6055" stroke-width="1.5"/><path d="M12 22h36v72H12l-4-4V26z" fill="#B48A5A"/><circle cx="30" cy="30" r="4" fill="#F7F2E9"/>'; }],
    sleeve: [100, 100, function (c) { return '<rect x="10" y="22" width="80" height="60" rx="3" fill="#26221F"/><rect x="10" y="40" width="80" height="24" fill="#EDE3CF"/><rect x="30" y="50" width="40" height="4" fill="#A8562E"/>'; }],
    sticker: [100, 100, function () { return '<circle cx="36" cy="50" r="22" fill="#EDE3CF" stroke="#A8562E" stroke-width="3"/><circle cx="68" cy="50" r="22" fill="#EDE3CF" stroke="#A8562E" stroke-width="3"/>'; }],
    wax: [100, 100, function () { return '<path d="M50 14l9 8 12-2 3 12 11 6-5 11 5 11-11 6-3 12-12-2-9 8-9-8-12 2-3-12-11-6 5-11-5-11 11-6 3-12 12 2z" fill="#8E2A22"/><circle cx="50" cy="50" r="16" fill="none" stroke="#B5463C" stroke-width="3"/>'; }],
    foil: [100, 100, function () { return '<rect x="12" y="24" width="76" height="56" rx="3" fill="#26221F"/><rect x="12" y="24" width="76" height="56" rx="3" fill="none" stroke="#C4A15A" stroke-width="5"/>'; }]
  };

  function icon(name, hex, opts) {
    opts = opts || {};
    var def = ICONS[name] || ICONS.card;
    var c = hex || '#B9B0A3';
    var body = def[2](c, shade(c, -0.28), shade(c, 0.45));
    var label = opts.label ? ' role="img" aria-label="' + esc(opts.label) + '"' : ' aria-hidden="true"';
    return '<svg viewBox="0 0 ' + def[0] + ' ' + def[1] + '" preserveAspectRatio="xMidYMax meet"' + label + ' focusable="false">' + body + '</svg>';
  }

  /* Small box drawing used on the box cards in step 1. */
  function boxThumb(shape, hex, opts) {
    opts = opts || {};
    var c = hex || '#26221F', d = shade(c, -0.25), l = shade(c, 0.18), body;
    if (shape === 'round') body = '<ellipse cx="60" cy="84" rx="40" ry="10" fill="' + d + '"/><rect x="20" y="40" width="80" height="44" fill="' + c + '"/><ellipse cx="60" cy="40" rx="40" ry="10" fill="' + l + '"/><rect x="18" y="30" width="84" height="12" fill="' + d + '"/><ellipse cx="60" cy="30" rx="42" ry="10" fill="' + l + '"/>';
    else if (shape === 'basket') body = '<path d="M30 46a30 26 0 0 1 60 0" fill="none" stroke="' + d + '" stroke-width="5"/><path d="M16 50h88l-8 38H24z" fill="' + c + '"/><path d="M20 60h80M22 70h76M24 80h72" stroke="' + d + '" stroke-width="2"/>';
    else if (shape === 'bag') body = '<path d="M42 40a18 18 0 0 1 36 0" fill="none" stroke="' + d + '" stroke-width="4"/><path d="M28 38h64l4 54H24z" fill="' + c + '"/><path d="M28 38h64v6H28z" fill="' + d + '"/>';
    else {
      var w = shape === 'square' ? 64 : 84, x = (120 - w) / 2;
      body = '<path d="M' + x + ' 50h' + w + 'l14-12H' + (x + 14) + 'z" fill="' + l + '"/><rect x="' + x + '" y="50" width="' + w + '" height="38" fill="' + c + '"/><path d="M' + (x + w) + ' 50l14-12v38l-14 12z" fill="' + d + '"/>';
      if (opts.lid !== 'none') body += '<path d="M' + (x - 2) + ' 50h' + (w + 4) + 'v8H' + (x - 2) + 'z" fill="' + d + '" opacity=".55"/>';
      if (opts.texture === 'wood') body += '<path d="M' + x + ' 62h' + w + 'M' + x + ' 75h' + w + '" stroke="' + d + '" stroke-width="1.5"/>';
    }
    return '<svg viewBox="0 0 120 100" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /* CSS backgrounds for materials and fillings. */
  function texture(kind, hex) {
    var c = hex || '#CCCCCC', d = shade(c, -0.18), l = shade(c, 0.22);
    switch (kind) {
      case 'shred': return 'repeating-linear-gradient(115deg,' + c + ' 0 2px,' + d + ' 2px 3px,' + l + ' 3px 5px),repeating-linear-gradient(35deg,transparent 0 3px,' + d + '55 3px 4px)';
      case 'crinkle': return 'linear-gradient(135deg,' + l + ' 25%,transparent 25%) -4px 0/8px 8px,linear-gradient(225deg,' + d + ' 25%,transparent 25%) -4px 0/8px 8px,linear-gradient(315deg,' + l + ' 25%,transparent 25%) 0 0/8px 8px,linear-gradient(45deg,' + d + ' 25%,' + c + ' 25%) 0 0/8px 8px';
      case 'tissue': return 'radial-gradient(ellipse at 20% 30%,' + l + ' 0 18%,transparent 40%),radial-gradient(ellipse at 70% 60%,' + l + ' 0 15%,transparent 38%),radial-gradient(ellipse at 45% 85%,' + d + '66 0 12%,transparent 30%),' + c;
      case 'fabric': return 'repeating-linear-gradient(45deg,' + c + ' 0 2px,' + d + '40 2px 3px),repeating-linear-gradient(-45deg,transparent 0 2px,' + l + '40 2px 3px),' + c;
      case 'satin': return 'linear-gradient(110deg,' + d + ' 0%,' + l + ' 22%,' + c + ' 40%,' + d + ' 55%,' + l + ' 75%,' + c + ' 100%)';
      case 'jute': return 'repeating-linear-gradient(80deg,' + d + ' 0 1px,transparent 1px 4px),repeating-linear-gradient(-20deg,' + l + '88 0 1px,transparent 1px 5px),' + c;
      case 'honeycomb': return 'radial-gradient(circle at 50% 50%,transparent 0 4px,' + d + ' 4px 5px,transparent 5px) 0 0/12px 10px,radial-gradient(circle at 50% 50%,transparent 0 4px,' + d + ' 4px 5px,transparent 5px) 6px 5px/12px 10px,' + c;
      case 'wood': return 'repeating-linear-gradient(90deg,' + c + ' 0 14px,' + d + ' 14px 15px,' + l + ' 15px 22px,' + c + ' 22px 31px),' + c;
      case 'weave': return 'repeating-linear-gradient(0deg,' + d + ' 0 2px,transparent 2px 7px),repeating-linear-gradient(90deg,' + l + '99 0 3px,transparent 3px 7px),' + c;
      case 'canvas': return 'repeating-linear-gradient(0deg,' + d + '30 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,' + d + '30 0 1px,transparent 1px 3px),' + c;
      case 'linen': return 'repeating-linear-gradient(0deg,' + l + '30 0 1px,transparent 1px 2px),repeating-linear-gradient(90deg,' + d + '30 0 1px,transparent 1px 2px),' + c;
      case 'kraft': return 'radial-gradient(' + d + '55 1px,transparent 1.5px) 0 0/7px 7px,' + c;
      case 'wrap': return 'radial-gradient(circle,' + '#A8562E' + ' 0 1.5px,transparent 2px) 0 0/16px 16px,radial-gradient(circle,#C4A15A 0 1.5px,transparent 2px) 8px 8px/16px 16px,#EDE3CF';
      default: return 'linear-gradient(180deg,' + l + ',' + c + ' 35%,' + d + ')';
    }
  }

  /* ---------- the CSS 3D renderer ---------- */
  var VIEWS = {
    front: { rx: -18, ry: -30, lid: true },
    side: { rx: -12, ry: -90, lid: true },
    top: { rx: -88, ry: 0, lid: false },
    inside: { rx: -52, ry: -18, lid: false }
  };

  function CssRenderer(el, opts) {
    this.el = el;
    this.opts = opts || {};
    this.view = 'front';
    this.rx = VIEWS.front.rx; this.ry = VIEWS.front.ry;
    this.zoom = 1;
    this.lidClosed = false;
    this.last = null;
    el.classList.add('kp-root');
    el.innerHTML = '<div class="kp-viewport" tabindex="0" role="img" aria-roledescription="3D preview" aria-label="Hamper preview. Drag or use arrow keys to rotate."><div class="kp-scene"></div></div>';
    this.viewport = el.querySelector('.kp-viewport');
    this.scene = el.querySelector('.kp-scene');
    this._bind();
  }

  CssRenderer.prototype._bind = function () {
    var self = this, drag = null;
    this._down = function (e) {
      if (e.button != null && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, rx: self.rx, ry: self.ry, id: e.pointerId };
      try { self.viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      self.viewport.classList.add('kp-dragging');
    };
    this._move = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      self.ry = drag.ry + (e.clientX - drag.x) * 0.45;
      self.rx = Math.max(-89, Math.min(0, drag.rx - (e.clientY - drag.y) * 0.35));
      self.view = 'custom';
      self._applyCamera(true);
    };
    this._up = function () { drag = null; self.viewport.classList.remove('kp-dragging'); if (self.onchange) self.onchange(); };
    this._key = function (e) {
      var k = e.key, used = true;
      if (k === 'ArrowLeft') self.ry -= 12;
      else if (k === 'ArrowRight') self.ry += 12;
      else if (k === 'ArrowUp') self.rx = Math.max(-89, self.rx - 8);
      else if (k === 'ArrowDown') self.rx = Math.min(0, self.rx + 8);
      else if (k === '+' || k === '=') self.zoom = Math.min(1.8, self.zoom * 1.12);
      else if (k === '-' || k === '_') self.zoom = Math.max(0.6, self.zoom / 1.12);
      else used = false;
      if (used) { e.preventDefault(); self.view = 'custom'; self._applyCamera(); if (self.onchange) self.onchange(); }
    };
    this.viewport.addEventListener('pointerdown', this._down);
    this.viewport.addEventListener('pointermove', this._move);
    this.viewport.addEventListener('pointerup', this._up);
    this.viewport.addEventListener('pointercancel', this._up);
    this.viewport.addEventListener('keydown', this._key);
  };

  CssRenderer.prototype.destroy = function () {
    this.viewport.removeEventListener('pointerdown', this._down);
    this.viewport.removeEventListener('pointermove', this._move);
    this.viewport.removeEventListener('pointerup', this._up);
    this.viewport.removeEventListener('pointercancel', this._up);
    this.viewport.removeEventListener('keydown', this._key);
    this.el.innerHTML = '';
  };

  CssRenderer.prototype.setView = function (name) {
    var v = VIEWS[name];
    if (!v) return;
    this.view = name; this.rx = v.rx; this.ry = v.ry;
    if (this.last) this.render(this.last.cfg, this.last.cat, this.last.ctx);
  };
  CssRenderer.prototype.zoomBy = function (f) { this.zoom = Math.max(0.6, Math.min(1.8, this.zoom * f)); this._applyCamera(); };
  CssRenderer.prototype.resetView = function () { this.zoom = 1; this.setView('front'); };
  CssRenderer.prototype.toggleLid = function () { this.lidClosed = !this.lidClosed; if (this.last) this.render(this.last.cfg, this.last.cat, this.last.ctx); return this.lidClosed; };
  CssRenderer.prototype.state = function () { return { view: this.view, zoom: this.zoom, lidClosed: this.lidClosed }; };

  CssRenderer.prototype._applyCamera = function (fast) {
    var g = this.geom;
    if (!g) return;
    this.scene.style.transition = fast ? 'none' : '';
    this.scene.style.transform = 'scale(' + n2(this.zoom) + ') rotateX(' + n2(this.rx) + 'deg) rotateY(' + n2(this.ry) + 'deg) translateY(' + n2(g.h * 0.45) + 'px)';
    // Sprites turn to face the camera sideways but only partly tilt with it,
    // so from above they read as items standing in the filling.
    var bill = 'rotateY(' + n2(-this.ry) + 'deg) rotateX(' + n2(-this.rx * 0.55) + 'deg)';
    var sprites = this.scene.querySelectorAll('[data-bb]');
    for (var i = 0; i < sprites.length; i++) sprites[i].style.transform = sprites[i].getAttribute('data-bb') + ' ' + bill;
  };

  /* element placed at (x, y-up, z) with optional extra transform */
  function at(cls, w, h, x, y, z, extra, inner, style) {
    return '<div class="' + cls + '" style="width:' + n2(w) + 'px;height:' + n2(h) + 'px;margin:' + n2(-h / 2) + 'px 0 0 ' + n2(-w / 2) + 'px;transform:translate3d(' + n2(x) + 'px,' + n2(-y) + 'px,' + n2(z) + 'px) ' + (extra || '') + ';' + (style || '') + '">' + (inner || '') + '</div>';
  }
  /* billboard sprite whose bottom-centre sits at (x, y-up, z) */
  function sprite(cls, w, h, x, y, z, inner, style) {
    var base = 'translate3d(' + n2(x) + 'px,' + n2(-y) + 'px,' + n2(z) + 'px)';
    return '<div class="' + cls + '" data-bb="' + base + '" style="width:' + n2(w) + 'px;height:' + n2(h) + 'px;margin:' + n2(-h) + 'px 0 0 ' + n2(-w / 2) + 'px;transform:' + base + ';' + (style || '') + '">' + (inner || '') + '</div>';
  }

  CssRenderer.prototype.render = function (cfg, cat, ctx) {
    ctx = ctx || {};
    this.last = { cfg: cfg, cat: cat, ctx: ctx };
    var P = ctx.pricing || (typeof KorePricing !== 'undefined' ? KorePricing : null);
    var box = P.findBox(cat, cfg.boxId);
    var si = P.sizeInfo(cat, box, cfg.size);
    var colours = cat.colours;
    function hex(id, fallback) { return id && colours[id] ? colours[id].hex : (fallback || '#CFC6B8'); }

    var W = si.dims[0], D = si.dims[1], H = si.dims[2];
    if (box.shape === 'square' || box.shape === 'round') D = W;
    var stage = Math.min(this.el.clientWidth || 420, this.el.clientHeight ? this.el.clientHeight * 1.25 : 420);
    var k = Math.max(3, Math.min(9, (stage * 0.5) / Math.max(W, D * 0.85, H * 1.8)));
    var w = W * k, d = D * k, h = H * k;
    this.geom = { w: w, d: d, h: h, k: k };

    var fin = {};
    cfg.finishing.forEach(function (id) { fin[id] = P.findFinishing(cat, id); });
    var ribbonId = fin['ribbon-satin'] ? 'ribbon-satin' : (fin['ribbon-grosgrain'] ? 'ribbon-grosgrain' : null);
    var ribbonHex = ribbonId ? hex(cfg.colours.ribbon) : null;
    var wrapPremium = !!fin['wrap-premium'], wrapClear = !!fin['wrap-clear'];

    var extHex = hex(cfg.colours.exterior), intHex = hex(cfg.colours.interior), lidHex = hex(cfg.colours.lid || cfg.colours.exterior);
    var outerBg = wrapPremium ? texture('wrap') : (box.texture === 'paper' ? texture('default', extHex) : texture(box.texture, extHex));
    var innerBg = cfg.lining === 'satin' ? texture('satin', intHex) : (cfg.lining === 'suede' ? texture('linen', intHex) : (box.texture === 'paper' ? intHex : texture(box.texture, intHex)));
    var foil = !!fin['foil-edge'];
    var view = this.view;
    var showLid = box.lid !== 'none' && view !== 'top' && view !== 'inside';
    var lidClosed = showLid && this.lidClosed;

    // ---- box label (hamper personalisation) ----
    var hp = cfg.hamper;
    var font = (P.byId(cat.fonts, hp.font) || cat.fonts[0]).css;
    var tHex = hex(hp.textColour, '#C4A15A');
    var lines = [hp.company, hp.name, hp.event, hp.greeting, hp.tagline].filter(Boolean);
    var logoHtml = hp.useLogo ? (ctx.logoUrl ? '<img class="kp-logo" src="' + esc(ctx.logoUrl) + '" alt="">' : '<span class="kp-logo kp-logo-ph">LOGO</span>') : '';
    function labelHtml(maxW, base) {
      if (!lines.length && !logoHtml) return '';
      var fs = Math.max(7, Math.min(base, maxW / 9));
      return '<div class="kp-label" style="font-family:' + esc(font) + ';color:' + tHex + ';font-size:' + n2(fs) + 'px;max-width:' + n2(maxW) + 'px">' + logoHtml + lines.map(function (t, i) { return '<span' + (i ? ' class="kp-sub"' : '') + '>' + esc(t) + '</span>'; }).join('') + '</div>';
    }

    var html = '';
    // floor shadow
    html += at('kp-shadow', w * 1.5, d * 1.5, 0, 0.5, 0, 'rotateX(90deg)');

    // ---- walls ----
    var faces = [];
    var sleeveHtml = fin.sleeve ? function (isFront) {
      return '<div class="kp-sleeve" style="background:' + (lum(extHex) > 0.4 ? '#26221F' : '#EDE3CF') + '">' + (isFront && hp.placement === 'sleeve' ? labelHtml(w * 0.8, h * 0.14) : '') + '</div>';
    } : function () { return ''; };
    var bandV = ribbonHex ? '<div class="kp-band-v" style="background:' + ribbonHex + '">' + (hp.ribbonText ? '<span class="kp-ribbon-text" style="color:' + onColour(ribbonHex) + '">' + esc(hp.ribbonText) + '</span>' : '') + '</div>' : '';
    var bandVPlain = ribbonHex ? '<div class="kp-band-v" style="background:' + ribbonHex + '"></div>' : '';
    var stickers = fin['seal-stickers'] ? '<div class="kp-stickers"><i></i><i></i></div>' : '';
    var waxFront = fin['wax-seal'] && !lidClosed ? '<div class="kp-wax"></div>' : '';
    var foilCls = foil ? ' kp-foil' : '';
    var frontLabel = (hp.placement === 'front' || (hp.placement === 'lid' && box.lid === 'none')) ? labelHtml(w * 0.8, h * 0.16) : '';

    function wall(x, z, rot, ww, isFront, isBack, extraOuter) {
      var a = n2(0.03 + 0.2 * (1 - Math.cos((rot + 35) * Math.PI / 180)) / 2);
      var outer = '<div class="kp-face kp-out' + foilCls + '" style="background:' + outerBg + ';box-shadow:inset 0 0 0 2000px rgba(0,0,0,' + a + '),inset 0 1px 0 rgba(255,255,255,.25)">' + (extraOuter || '') + '</div>';
      var inner = '<div class="kp-face kp-in" style="background:' + innerBg + '"></div>';
      return at('kp-wall', ww, h, x, h / 2, z, 'rotateY(' + rot + 'deg)', outer + inner);
    }

    if (box.shape === 'round') {
      var N = 24, r = w / 2, segW = 2 * r * Math.tan(Math.PI / N) + 1;
      for (var i = 0; i < N; i++) {
        var th = (i / N) * 360, rad = th * Math.PI / 180;
        var isFront = i === 0;
        var extra = (ribbonHex ? '<div class="kp-band-h" style="background:' + ribbonHex + '"></div>' : '') + (isFront ? frontLabel + stickers + waxFront : '');
        faces.push(wall(Math.sin(rad) * r, Math.cos(rad) * r, th, segW, isFront, false, extra));
      }
      html += at('kp-base', w, w, 0, 0.2, 0, 'rotateX(90deg)', '', 'border-radius:50%;background:' + innerBg);
    } else {
      var frontExtra = sleeveHtml(true) + (box.shape === 'rect' || box.shape === 'square' ? bandV : '') + frontLabel + stickers + waxFront;
      faces.push(wall(0, d / 2, 0, w, true, false, frontExtra));
      faces.push(wall(0, -d / 2, 180, w, false, true, sleeveHtml(false) + (box.shape === 'rect' || box.shape === 'square' ? bandVPlain : '')));
      faces.push(wall(-w / 2, 0, -90, d, false, false, sleeveHtml(false) + (box.shape === 'rect' || box.shape === 'square' ? bandVPlain : '')));
      faces.push(wall(w / 2, 0, 90, d, false, false, sleeveHtml(false) + (box.shape === 'rect' || box.shape === 'square' ? bandVPlain : '')));
      html += at('kp-base', w, d, 0, 0.2, 0, 'rotateX(90deg)', '', 'background:' + innerBg);
    }
    html += faces.join('');

    // handles for basket and bag
    if (box.shape === 'basket') html += at('kp-handle', w * 0.62, h * 0.9, 0, h + h * 0.45, 0, '', '', 'border-color:' + shade(extHex, -0.3));
    if (box.shape === 'bag') {
      html += at('kp-handle kp-rope', w * 0.4, h * 0.45, 0, h + h * 0.22, d / 2 - 1, '', '', 'border-color:' + shade(extHex, -0.35));
      html += at('kp-handle kp-rope', w * 0.4, h * 0.45, 0, h + h * 0.22, -d / 2 + 1, 'rotateY(180deg)', '', 'border-color:' + shade(extHex, -0.35));
    }

    // ---- filling ----
    var filling = P.findFilling(cat, cfg.fillingId);
    var fh = filling.texture === 'none' ? 1 : h * 0.62;
    if (filling.texture !== 'none') {
      var fHex = hex(cfg.fillingColour, '#D8CBB6');
      var fBg = texture(filling.texture, fHex);
      var round = box.shape === 'round' ? 'border-radius:50%;' : '';
      html += at('kp-fill', w - 2, d - 2, 0, fh, 0, 'rotateX(90deg)', '', round + 'background:' + fBg);
      // soft mounds so the bed has volume
      var mounds = [[-0.3, 0.32], [0.05, 0.36], [0.32, 0.3], [-0.34, -0.3], [0.3, -0.34]];
      mounds.forEach(function (m) {
        var mx = m[0] * w, mz = m[1] * d;
        if (box.shape === 'round') { var rr = w / 2 * 0.8, len = Math.sqrt(mx * mx + mz * mz); if (len > rr) { mx *= rr / len; mz *= rr / len; } }
        html += sprite('kp-mound', w * 0.3, h * 0.2, mx, fh - h * 0.08, mz, '', 'background:' + fBg);
      });
    }

    // ---- products ----
    var spritesList = [];
    cfg.items.forEach(function (it) {
      var p = P.findProduct(cat, it.productId);
      if (!p) return;
      var copies = Math.min(it.qty, 3);
      for (var c = 0; c < copies; c++) spritesList.push({ p: p, it: it, copy: c, more: c === copies - 1 && it.qty > copies ? it.qty - copies : 0 });
    });
    spritesList = spritesList.slice(0, 18);
    var visibleItems = spritesList.length;
    spritesList.sort(function (a, b) { return b.p.dims[1] - a.p.dims[1]; });
    var rows = visibleItems <= 4 ? 1 : (visibleItems <= 10 ? 2 : 3);
    var perRow = Math.ceil(visibleItems / rows);
    var rowZ = rows === 1 ? [-d * 0.05] : (rows === 2 ? [-d * 0.22, d * 0.16] : [-d * 0.3, 0, d * 0.26]);
    for (var rI = 0; rI < rows; rI++) {
      var row = spritesList.slice(rI * perRow, rI * perRow + perRow);
      if (!row.length) continue;
      var z = rowZ[rI];
      var maxRowW = box.shape === 'round' ? 2 * Math.sqrt(Math.max(0, Math.pow(w / 2 * 0.9, 2) - z * z)) : w * 0.9;
      var widths = row.map(function (s) { return s.p.dims[0] * k; });
      var total = widths.reduce(function (a, b) { return a + b; }, 0);
      var gap = 4;
      var scale = Math.min(1, (maxRowW - gap * (row.length - 1)) / total);
      var span = total * scale + gap * (row.length - 1);
      var x = -span / 2;
      row.forEach(function (s, idx) {
        var sw = widths[idx] * scale, sh = s.p.dims[1] * k * scale;
        var maxH = h * 2.2;
        if (sh > maxH) { sw *= maxH / sh; sh = maxH; }
        var cx = x + sw / 2;
        x += sw + gap;
        var sink = Math.min(sh * 0.3, fh * 0.75);
        var colHex = s.it.colour ? hex(s.it.colour) : null;
        var inner = icon(s.p.icon, colHex);
        var pers = s.it.personal;
        if (pers.on && (pers.text || pers.logo) && s.copy === 0) {
          var pf = (P.byId(cat.fonts, pers.font) || cat.fonts[1]).css;
          inner += '<span class="kp-ptext" style="font-family:' + esc(pf) + ';color:' + hex(pers.textColour) + ';font-size:' + n2(Math.max(5, Math.min(11, sw * 0.16))) + 'px">' + (pers.logo ? (ctx.logoUrl ? '<img src="' + esc(ctx.logoUrl) + '" alt="">' : '<b>LOGO</b>') : '') + esc(pers.text) + '</span>';
        }
        if (s.more) inner += '<span class="kp-more">+' + s.more + '</span>';
        spritesList[spritesList.indexOf(s)].html = sprite('kp-item', sw, sh, cx, fh - sink, z + (idx % 2 ? 3 : -3), inner);
      });
    }
    spritesList.forEach(function (s) { if (s.html) html += s.html; });

    // ---- card inside ----
    var cardF = fin['card-greeting'] || fin['card-thanks'] || fin['card-message'];
    if (cardF) {
      var cardText = fin['card-message'] ? (hp.message || 'Your message') : (fin['card-thanks'] ? 'Thank you' : (hp.greeting || 'Greetings'));
      var cw = Math.min(10 * k, w * 0.28), ch = cw * 1.4;
      var cxp = box.shape === 'round' ? w * 0.18 : w * 0.34;
      html += sprite('kp-card', cw, ch, cxp, fh - ch * 0.25, -d * 0.36, '<span style="font-family:' + esc(font) + '">' + esc(cardText.length > 60 ? cardText.slice(0, 57) + '…' : cardText) + '</span>');
    }

    // ---- lid ----
    if (showLid) {
      var lh = Math.min(h * 0.32, 3.2 * k);
      var lw = w + 4, ld = d + 4;
      var lidBg = wrapPremium ? texture('wrap') : (box.texture === 'paper' ? texture('default', lidHex) : texture(box.texture, lidHex));
      var lidTopExtra = (ribbonHex && box.shape !== 'round' ? '<div class="kp-band-v" style="background:' + ribbonHex + '"></div><div class="kp-band-h kp-band-mid" style="background:' + ribbonHex + '"></div>' : '') +
        (hp.placement === 'lid' ? labelHtml(lw * 0.7, h * 0.18) : '') + (fin['wax-seal'] && lidClosed ? '<div class="kp-wax kp-wax-lid"></div>' : '');
      var lidHtml = '';
      var sliding = box.lid === 'sliding';
      if (box.shape === 'round') {
        lidHtml += at('kp-lidtop' + foilCls, lw, lw, 0, 0, 0, 'rotateX(90deg)', lidTopExtra, 'border-radius:50%;background:' + lidBg);
        var LN = 24, lr = lw / 2, lseg = 2 * lr * Math.tan(Math.PI / LN) + 1;
        for (var j = 0; j < LN; j++) {
          var lth = (j / LN) * 360, lrad = lth * Math.PI / 180;
          lidHtml += at('kp-lidrim' + foilCls, lseg, lh, Math.sin(lrad) * lr, -lh / 2, Math.cos(lrad) * lr, 'rotateY(' + lth + 'deg)', '', 'background:' + lidBg);
        }
      } else {
        lidHtml += at('kp-lidtop' + foilCls, lw, ld, 0, 0, 0, 'rotateX(90deg)', lidTopExtra, 'background:' + lidBg);
        if (!sliding) {
          var rimBand = ribbonHex ? '<div class="kp-band-v" style="background:' + ribbonHex + '"></div>' : '';
          lidHtml += at('kp-lidrim' + foilCls, lw, lh, 0, -lh / 2, ld / 2, '', rimBand, 'background:' + lidBg);
          lidHtml += at('kp-lidrim' + foilCls, lw, lh, 0, -lh / 2, -ld / 2, 'rotateY(180deg)', rimBand, 'background:' + lidBg);
          lidHtml += at('kp-lidrim' + foilCls, ld, lh, -lw / 2, -lh / 2, 0, 'rotateY(-90deg)', rimBand, 'background:' + lidBg);
          lidHtml += at('kp-lidrim' + foilCls, ld, lh, lw / 2, -lh / 2, 0, 'rotateY(90deg)', rimBand, 'background:' + lidBg);
        }
      }
      var lidT;
      if (lidClosed) lidT = 'translate3d(0px,' + n2(-(h + (sliding ? 1 : lh * 0.25))) + 'px,0px)';
      else if (sliding) lidT = 'translate3d(0px,' + n2(-(h + 1)) + 'px,' + n2(-d * 0.62) + 'px)';
      else if (box.lid === 'magnetic') lidT = 'translate3d(0px,' + n2(-h) + 'px,' + n2(-d / 2) + 'px) rotateX(-100deg) translate3d(0px,0px,' + n2(d / 2) + 'px)';
      else {
        var depth = box.shape === 'round' ? lw : ld;
        lidT = 'translate3d(0px,' + n2(-(depth * 0.49 + 2)) + 'px,' + n2(-(d / 2 + depth * 0.15 + lh + 6)) + 'px) rotateX(-74deg)';
      }
      if (fin.bow && ribbonHex && !lidClosed) {
        var bw0 = Math.min(lw * 0.36, 14 * k);
        var bowZ0 = (box.shape === 'round' ? lw : ld) * 0.3;
        lidHtml += at('kp-bow kp-bow-flat', bw0, bw0 * 0.7, 0, 1, bowZ0, 'rotateX(90deg)', icon('bow', ribbonHex));
      }
      html += '<div class="kp-lid" style="transform:' + lidT + '">' + lidHtml + '</div>';
    }

    // ---- bow, tag, clear wrap ----
    var bowOnLid = showLid && !lidClosed;
    if (fin.bow && ribbonHex && !bowOnLid && !(box.lid !== 'none' && (view === 'top' || view === 'inside'))) {
      var bw = Math.min(w * 0.4, 14 * k), bh = bw * 0.7;
      var bowY = lidClosed ? h + (box.lid === 'sliding' ? 1 : lh) : h;
      var bowZ = lidClosed ? 0 : (box.shape === 'round' ? w / 2 : d / 2) + 2;
      if (box.shape === 'basket' || box.shape === 'bag') { bowY = h * 1.25; bowZ = box.shape === 'bag' ? d / 2 : 0; }
      html += sprite('kp-bow', bw, bh, 0, bowY - bh * 0.2, bowZ, icon('bow', ribbonHex));
    }
    if (fin['gift-tag']) {
      var tw = Math.max(18, 5 * k), th2 = tw * 1.6;
      var tagText = hp.placement === 'tag' ? (hp.name || hp.company || '') : (hp.name || '');
      html += sprite('kp-tag', tw, th2, w / 2 - tw * 0.2, h * 0.92 - th2 * 0.6 + th2 * 0.6, (box.shape === 'round' ? w / 2 : d / 2) + 3, icon('tag') + (tagText ? '<span style="font-family:' + esc(font) + '">' + esc(tagText) + '</span>' : (hp.placement === 'tag' && logoHtml ? logoHtml : '')));
    }
    if (wrapClear) {
      var wh = h * 1.7, ww2 = w + 8, wd2 = d + 8;
      html += at('kp-clear', ww2, wh, 0, wh / 2, wd2 / 2, '');
      html += at('kp-clear', ww2, wh, 0, wh / 2, -wd2 / 2, 'rotateY(180deg)');
      html += at('kp-clear', wd2, wh, -ww2 / 2, wh / 2, 0, 'rotateY(-90deg)');
      html += at('kp-clear', wd2, wh, ww2 / 2, wh / 2, 0, 'rotateY(90deg)');
      html += sprite('kp-gather', Math.max(24, w * 0.22), Math.max(18, h * 0.5), 0, wh - 4, 0, '<svg viewBox="0 0 40 30" aria-hidden="true"><path d="M4 30C10 16 16 10 20 8c4 2 10 8 16 22z" fill="#DCE8EE" opacity=".8"/><path d="M14 10l6 4 6-4" stroke="' + (ribbonHex || '#A8562E') + '" stroke-width="3" fill="none"/></svg>');
    }

    this.scene.innerHTML = html;
    this._applyCamera();
  };

  var renderers = {
    css: { isSupported: function () { return true; }, create: function (el, opts) { return new CssRenderer(el, opts); } }
  };

  function registerRenderer(name, def) { renderers[name] = def; }

  function create(el, opts) {
    opts = opts || {};
    var def = renderers[opts.renderer];
    if (!def || !def.isSupported(opts.catalogue)) def = renderers.css;
    var r = def.create(el, opts);
    r.kind = def === renderers.css ? 'css' : opts.renderer;
    return r;
  }

  return { create: create, registerRenderer: registerRenderer, icon: icon, boxThumb: boxThumb, texture: texture, shade: shade, onColour: onColour, esc: esc, VIEWS: VIEWS };
});
