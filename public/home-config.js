/*
 * Homepage settings.
 * builderHref:     where "Customize Your Hamper" links go (the configurator page).
 * enquiryEndpoint: enquiry API ('/api/enquiries', api/enquiries.js on Vercel).
 *                  If it is not set up yet the form still works: it opens the
 *                  enquiry as a ready-to-send email to enquiryEmail.
 * enquiryEmail:    where the enquiry email is addressed.
 * threeSources:    where the 3D library is loaded from, first that works wins.
 */
window.KORE_SITE_CONFIG = {
  builderHref: 'customize-hamper.html',
  enquiryEndpoint: '/api/enquiries',
  enquiryEmail: 'koreexpression@gmail.com',
  threeSources: [
    ['vendor/three/three.min.js', 'vendor/three/RoomEnvironment.js'],
    ['https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/environments/RoomEnvironment.js']
  ]
};
