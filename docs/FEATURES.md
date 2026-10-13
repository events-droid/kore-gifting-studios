# KORE Gifting Studio · Feature guide

> This is the original feature documentation (how the homepage film, the hamper builder, pricing and the catalogue work). To deploy the site on Vercel, read `../README.md`. Where this guide talks about the Node server and `data/` folders, that is the optional self-hosted version in `server/`; on Vercel the same job is done by the functions in `api/` with a Redis database.

Two pages and a small server:

- **Homepage** (`public/index.html`): a cinematic, scroll-driven story. A closed hamper unties, opens and presents four personalised products, then the page continues through Meaning, Occasions, Personalisation, Corporate gifting, Studio and an enquiry form.
- **Customize Your Hamper** (`public/customize-hamper.html`): the hamper builder described below.

## The homepage

**How it works.** The story section is a tall block (760vh on desktop, 560vh on phones) with a sticky stage inside it. Scroll position inside that block becomes film progress from 0 to 1, and the Three.js scene is posed for that exact progress, so the film plays forwards and backwards with the scrollbar. There is no scroll hijacking and no animation library: native scrolling, `requestAnimationFrame` with time-based easing, and Three.js r147 (the same vendored copy the builder uses). The scene renders only when progress changes.

**Look.** A dark product-photography set: espresso-black page with champagne-gold accents (`home.css` tokens at the top), and a 3D scene lit by one soft warm key light and a back light on a dark stone table. Materials use textures generated in the browser (woven linen, paper fibre, pebbled leather, powder coat, satin, brushed metal), the box and lid have softened edges and a paper lining, the bow is made of flat satin bands, and the filling is crinkle-cut paper. Nothing is downloaded for this beyond Three.js.

**Timeline** (in `home-scene.js`, `TIMELINE`): push-in 0–0.10, ribbon unties and bow releases 0.06–0.18, lid lifts and opens 0.15–0.29, tissue unfolds 0.27–0.35, warm light 0.28–0.38, then the bottle ("Made Personal."), notebook ("Your Story, Beautifully Bound."), mug ("A Little Something, Just for You.") and pen with accessories rise one after another, and the camera pulls back to the full collection ("Every Detail. Your Choice." → Create Your Own Hamper). Captions are timed from the same table in `home.js`.

**Links into the builder.** Every product scene links to `customize-hamper.html#add-<product id>`. The builder adds that product, opens the Personalise step and confirms with a message. Change the target in `home-config.js` (`builderHref`).

**Fallbacks.**
- Reduced motion, no WebGL, or the 3D library failing to load (local copy, then CDN, 20-second limit) all switch to a still-frame story: the same chapters as pre-rendered images with their captions. Nothing else on the page depends on the 3D view.
- Slow devices: if frames average over 45 ms the scene drops to low quality; over 160 ms it switches to the still-frame story.
- Phones get a shorter story, a portrait camera, captions as bottom panels and a lighter render.
- "Skip the intro" is the first keyboard stop, and "Skip to the collection" sits on the stage.

**Files.**

| File | What it is |
|---|---|
| `public/index.html` | Homepage markup and all copy. |
| `public/home.css` | Homepage styles (nav, sticky stage, captions, chapters, phone and reduced-motion rules). |
| `public/home.js` | Scroll-to-progress controller, captions, chapter jumps, fallbacks, nav and mobile menu, enquiry form. |
| `public/home-scene.js` | The 3D film: procedural hamper, ribbon, lid, tissue and products; timeline; cameras; still renderer. |
| `public/home-config.js` | Builder link, enquiry endpoint, 3D library sources. |
| `public/img/` | WebP stills rendered from the same scene (poster, still-frame story, exploded view (the craft close-ups are kept for reuse but not shown on the page)) and the occasion and studio photos. About 1.7 MB in total; the first-paint poster is about 16 KB. |
| `server/enquiry-handler.js` | Validates, saves and emails homepage enquiries. |

**Enquiries.** The bundled server answers `POST /api/enquiries` and sets the endpoint for the page automatically. Each enquiry gets a reference like `ENQ-261012-7KQ2M`, is saved to `ENQUIRIES_DIR` (default `data/enquiries`) **before** any email is sent, then KORE and the customer are emailed with the same Resend settings as orders. A failed email is recorded on the saved enquiry; `retry-emails` currently resends order emails only.

**Assets still to supply.** Real product photography (the occasion photos are yours; products in the film are procedural models with sample names such as "Priya"), GLB models if the film should show the exact products, real prices, phone number and corporate price table (the page keeps the existing placeholders).

---

# Customize Your Hamper

A step-by-step hamper builder for the KORE website: box → filling → products → colours → personalise → finishing touches → review and quantity → customer details → quotation request. It has a real-time 3D preview (Three.js/WebGL) and live pricing, and orders go to a small Node server that re-checks prices, saves the order and emails it to KORE.

Plain HTML, CSS and JavaScript. No framework, no build step, no npm dependencies. Three.js r147 is included in `public/vendor/three/` (MIT licence), with a pinned CDN copy as a backup.

## Files

| File | What it is |
|---|---|
| `public/customize-hamper.html` | The page. Add it to the site and link it from the navigation. |
| `public/customize-hamper.css` | Styles, all scoped to `.hamper-configurator` so nothing else on the site changes. Light and dark themes. |
| `public/customize-hamper.js` | Page controller: steps, product search, personalisation, logo upload, review, order form, submission. |
| `public/hamper-catalogue.js` | **The catalogue.** Boxes, sizes, fillings, products, colours, finishing touches, personalisation charges, pricing rules. Edit this to change what is sold and for how much. |
| `public/hamper-pricing.js` | Rules and pricing engine shared by the page and the server (one source of truth). |
| `public/hamper-preview-3d.js` | **The 3D preview.** Three.js scene: procedural box, lid, filling, products, ribbons, labels; orbit camera; loading state; fallback. |
| `public/hamper-preview.js` | Preview interface and the CSS fallback renderer used when WebGL is unavailable. |
| `public/vendor/three/` | Three.js, OrbitControls, GLTFLoader, RoomEnvironment (r147). |
| `public/hamper-config.js` | Site settings: order API URL, header links. |
| `server/server.js` | Order server: serves `public/` and accepts `POST /api/orders`. |
| `server/order-handler.js` | Validates, re-prices, stores the order and logo, sends emails. Framework-independent. |
| `server/emails.js` | Business notification and customer acknowledgement content. |
| `server/mailer.js` | Email through Resend's HTTP API. |
| `server/storage.js` | File storage for orders (`data/orders/*.json`) and logos (`data/uploads/`). |
| `server/retry-emails.js` | Resends notification emails that failed. |
| `tests/run-tests.js` | 20 automated tests for pricing, rules, the order flow and enquiries. |
| `.env.example` | Server settings. |

## Run it locally

```bash
npm start            # http://localhost:8080/ (homepage) and /customize-hamper
npm test             # node --test, 20 tests
```

Without email settings the server still saves every order and says honestly that email is not configured.

## Adding it to the existing website

1. Copy the `public/` files next to the site's pages (or into an `/assets/hamper/` folder and adjust the paths in the HTML).
2. Add **Customize Your Hamper** to the site navigation, linking to `customize-hamper.html` (or a `/customize-hamper` route). The server already answers `/customize-hamper`.
3. In `hamper-config.js` set `nav`, `homeHref` and `enquireHref` to the site's real routes. If the site has its own header, delete `<header class="kh-header">` from the HTML and keep the site's.
4. Set `orderEndpoint: '/api/orders'` (the bundled server does this automatically when it serves the page).

## Updating products, images and prices

Everything lives in `public/hamper-catalogue.js`. The server reads the same file, so the page and the server can never disagree.

- **Prices**: every price is a **demonstration value**. Replace them, then set `meta.pricesAreDemo = false` (this removes the "Demo prices" labels).
- **Add a product**: copy an entry in `products` and give it a unique `id`. Set `volume` (space it takes; compare with each size's `capacity`), `dims` ([width, height] in cm for the preview), `colours`, optional `variants`, `personal` (supported methods, fields, character limit, placements), `maxPerHamper`, and `stock` (`null` = not tracked; a number blocks orders that need more).
- **Product photos**: set `image: '/images/products/steel-bottle.jpg'`. Product cards show the photo; the preview keeps its drawing until a 3D model is added.
- **Boxes**: `sizes` holds the price per size; `colours.exterior / interior / lid` limit which colours can be picked; `linings` holds material upgrades with their surcharge.
- **GST, delivery, volume discounts**: `pricing.taxRate`, `pricing.deliveryCharge` and `pricing.bulkTiers` are deliberately empty. Until they are set, the page shows "On quotation" instead of inventing a figure.
- **Personalisation charges**: `methods` (per item) and `hamperPersonal` (per hamper).

## Order server and email settings

Set these on the host (see `.env.example`). Secrets never go in browser files.

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | API key from [Resend](https://resend.com). |
| `FROM_EMAIL` | Sender on a domain verified in Resend, e.g. `KORE Gifting Studio <orders@kore-domain.in>`. |
| `BUSINESS_EMAIL` | Where new orders go. Comma-separate several addresses. |
| `SEND_CUSTOMER_ACK` | `true` (default) emails the customer an acknowledgement. |
| `ORDERS_DIR`, `UPLOADS_DIR` | Persistent folders for orders and logos. |
| `ENQUIRIES_DIR` | Persistent folder for homepage enquiries. |
| `ALLOWED_ORIGIN` | Only if the page and API are on different domains. |
| `PORT` | Defaults to 8080. |

**What happens on "Send quotation request":** the browser checks the form, then the server validates the customer and the hamper again, re-prices it from its own catalogue (a price sent by the browser is ignored and flagged if it differs), checks the logo by its real file content (PNG/JPG/WebP, max 2 MB) and saves it under a generated name, creates a reference like `KORE-261009-ZWU87`, **saves the order first**, then emails KORE (with the logo attached) and the customer. If email fails, the order is kept, the failure is recorded on the order, and the customer is told the truth. Run `npm run retry-emails` (by hand or from cron) to resend.

It is a **quotation request**: no payment is taken.

**Hosting**: any Node 18+ host with persistent disk (a small VPS, Render, Railway, Fly.io). For serverless hosting (Vercel, Netlify), wrap `createOrderHandler` in a function and replace `server/storage.js` with a database adapter offering the same `exists / save / update / get / list` methods, because serverless disks are not persistent.

## Order and enquiry emails

Every final-step button builds an email addressed to **koreexpression@gmail.com**, with what the visitor chose typed out, and opens it ready to send:

- **Send quotation request** (the last step of Customize Your Hamper) writes the contact details, order details, box, colours, lining, filling, every product with its colour and quantity, personalisation, finishing touches, logo file name and the price estimate into the email.
- **Enquire Now** on the homepage (the enquiry form) writes the occasion, recipient count, name, work email and company.
- Both open a Gmail compose tab straight from the click. The result also shows "Open in your email app" (a `mailto:` link) and, on the builder, "Copy email text". Very long orders fall back to a shorter email in the link, and the full text stays in the copy box.
- A web page cannot send an email by itself, so the visitor presses **Send** in the draft. The order is also saved when the order server or the artifact order inbox is available, and the draft still opens if saving fails.
- A logo cannot be attached automatically; the email names the file and the page reminds the visitor to attach it.

To change the address, edit `orderEmail` in `public/hamper-config.js` and `enquiryEmail` in `public/home-config.js`. Staying fully automatic (no Send press) needs the order server with email configured, as described above.

## The 3D preview

`hamper-preview-3d.js` registers the `webgl` renderer; `hamper-config.js` selects it with `previewRenderer: 'webgl'`. It reads the same configuration object as the price and the order, so the preview, the summary and the submitted order always agree. There is no separate 3D pricing.

- **Scene**: box body with separate exterior, interior and rim materials; a lid that stands behind the box, closes, slides (wooden crate) or disappears in Top and Inside views; shredded, crinkle or jute strands (instanced) or draped tissue, cotton or satin; every product as a 3D object at its catalogue size; ribbon bands, bow, sleeve, gift tag, greeting card, seal stickers, wax seal, gold foil edge, premium or clear wrap; printed text and logo as textures on the lid, front, sleeve, tag, ribbon or product surface.
- **Materials**: paper, linen, wood, woven jute, canvas, kraft, satin, suede, metal, ceramic, glass and fabric finishes. Colours come from the catalogue, so a new colour or product needs no 3D code.
- **Camera**: drag to rotate, scroll or pinch to zoom, double-click a product to fly to it, Front, Side, Top and Inside views, Reset. Angles and zoom are limited so the hamper stays in view.
- **Arrangement**: products are laid out in rows, tallest at the back, sitting in the filling and fitted to the box shape and size. Fit uses typical product sizes, so it is an approximate check. Real capacity limits still come from the catalogue (`volume` and size `capacity`) and block the order when exceeded. If the preview has to squeeze items, the page says "Tight fit in the preview".
- **Performance**: renders only when something changes, pauses when off screen, caps pixel ratio, caches materials, textures, product shapes and models, and disposes what is no longer used. Rebuilds during typing are coalesced to one per frame.
- **Fallback**: if WebGL is missing, the library fails to load (local copy, then CDN, 20-second limit) or the graphics context is lost, the page switches to the CSS preview automatically and every other feature keeps working.

### Replacing placeholders with GLB/glTF models

Add `model: '/models/steel-bottle.glb'` to any product in `hamper-catalogue.js`. The model is loaded once, cloned for every copy, scaled to the product's catalogue height (`dims[1]`, in cm) and stood on the filling. The procedural shape shows until the model arrives, and stays if the model fails to load.

For colour changes, name the colourable mesh or material **body** in Blender (or similar). A model that is a single combined mesh with one material is tinted as a whole; a combined mesh whose parts share one material cannot have its parts coloured separately, so split it or give the body its own material. Printed text on products is drawn on the procedural shapes; on a GLB model it needs a named label surface, which is not wired up yet.

Box, lid and filling models are not loaded yet: those are procedural so they can change shape, size and material instantly. To swap in modelled boxes, extend `_build` in `hamper-preview-3d.js` where the box body is created.

## Still needed before going live

- Real prices, stock and lead times in `hamper-catalogue.js` (all current values are demo values).
- GST rate, delivery rules and any volume discounts, if they should show before quotation.
- Product photos, and GLB models if you want photo-real products (the procedural 3D shapes work without them).
- A Resend account with a verified sending domain, plus the environment variables above.
- A host with persistent storage for orders and logos.
- The final brand name: the page uses **KORE**, as set on the site.
