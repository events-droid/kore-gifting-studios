/*
 * Site-level settings for the Customize Your Hamper page.
 *
 * orderEndpoint: URL of the order API. On Vercel this is the serverless
 *   function in api/orders.js. If the API is not set up yet (no database
 *   environment variables) the page still works: the final button opens the
 *   order as a ready-to-send email to orderEmail.
 * orderEmail: where the order email is addressed.
 * nav: links shown in the page header. Point them at your real routes.
 */
window.KORE_HAMPER_CONFIG = {
  orderEndpoint: '/api/orders',
  orderEmail: 'koreexpression@gmail.com',
  storageKey: 'kore-hamper-v1',
  brand: 'KORE',
  brandSub: 'Gifting Studios',
  logoSrc: 'img/kore-logo.png',
  homeHref: 'index.html',
  enquireHref: 'index.html#enquiry',
  nav: [
    { label: 'Home', href: 'index.html' },
    { label: 'Hampers', href: 'index.html#occasions' },
    { label: 'Corporate Gifting', href: 'index.html#corporate' },
    { label: 'Customize Your Hamper', href: '#customize', current: true }
  ],
  // 'webgl' = real-time 3D (Three.js). Falls back to 'css' automatically
  // when WebGL or the library is unavailable.
  previewRenderer: 'webgl'
  // threeSources: [{ three, orbit, gltf, room }, ...]  optional override of
  // where Three.js is loaded from (local vendor copy first, CDN second).
};
