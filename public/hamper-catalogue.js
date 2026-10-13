/*
 * KORE hamper catalogue: the single place to edit boxes, fillings, products,
 * finishing touches, colours and pricing rules.
 *
 * IMPORTANT: every price in this file is a DEMONSTRATION value. Replace them
 * with KORE's real rates before going live, then set meta.pricesAreDemo = false.
 *
 * Prices are in Indian Rupees, per single unit, before GST.
 * The same file is loaded by the browser (window.KoreCatalogue) and by the
 * order server (require), so the server always re-prices from this data.
 *
 * Optional 3D: any box, filling, product or finishing entry may carry a
 * `model` field (path to a .glb/.gltf file). The preview uses the built-in
 * CSS renderer until a GLB renderer is registered (see hamper-preview.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KoreCatalogue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var catalogue = {
    meta: {
      version: '2026-10-09-demo',
      business: 'KORE Gifting Studio',
      currency: 'INR',
      locale: 'en-IN',
      pricesAreDemo: true
    },

    /* Order-level rules. null means "not configured": the page then says the
     * amount is confirmed on the quotation instead of inventing a figure. */
    pricing: {
      taxRate: null,          // e.g. 0.18 for 18% GST once confirmed
      taxLabel: 'GST',
      deliveryCharge: null,   // flat per order, e.g. 500, once confirmed
      deliveryNote: 'Quoted with your order, based on addresses and dates',
      /* Volume tiers apply a % discount to the per-hamper price.
       * Left empty on purpose: add real tiers here, e.g.
       * { minHampers: 100, discountPct: 5, label: '100+ hampers' } */
      bulkTiers: [],
      minHampers: 1,
      maxHampersPerOrder: 5000, // technical guard, adjust as needed
      leadTimeDays: 7           // earliest delivery date offered in the form
    },

    colours: {
      black:      { label: 'Charcoal black', hex: '#26221F' },
      white:      { label: 'Paper white',    hex: '#F7F5F0' },
      ivory:      { label: 'Ivory',          hex: '#EDE3CF' },
      beige:      { label: 'Sand beige',     hex: '#D7C3A0' },
      navy:       { label: 'Navy blue',      hex: '#1F3A5F' },
      forest:     { label: 'Forest green',   hex: '#2F5240' },
      burgundy:   { label: 'Burgundy',       hex: '#6B2234' },
      blush:      { label: 'Pastel blush',   hex: '#E6C3BC' },
      sage:       { label: 'Pastel sage',    hex: '#B4C3A6' },
      sky:        { label: 'Pastel sky',     hex: '#BFD3E0' },
      gold:       { label: 'Antique gold',   hex: '#C4A15A' },
      silver:     { label: 'Silver',         hex: '#B9BCBE' },
      terracotta: { label: 'Terracotta',     hex: '#A8562E' },
      red:        { label: 'Festive red',    hex: '#9E2B25' },
      kraft:      { label: 'Natural kraft',  hex: '#B48A5A' },
      pine:       { label: 'Natural pine',   hex: '#D6B98A' },
      walnut:     { label: 'Walnut stain',   hex: '#6E4A2F' },
      whitewash:  { label: 'Whitewash',      hex: '#E9E2D3' },
      jute:       { label: 'Natural jute',   hex: '#BFA37A' },
      steel:      { label: 'Brushed steel',  hex: '#A7ADB1' }
    },

    /* Box sizes. dims = [width, depth, height] in cm.
     * capacity = how many "volume units" of products fit (see product.volume).
     * fillFactor scales the filling price. */
    sizes: {
      s:  { label: 'Small',       dims: [25, 20, 10], capacity: 6,  fillFactor: 1 },
      m:  { label: 'Medium',      dims: [32, 25, 12], capacity: 10, fillFactor: 1.4 },
      l:  { label: 'Large',       dims: [40, 30, 14], capacity: 15, fillFactor: 1.8 },
      xl: { label: 'Extra-large', dims: [48, 36, 16], capacity: 22, fillFactor: 2.3 }
    },

    boxes: [
      {
        id: 'square-rigid', name: 'Square rigid box', shape: 'square', lid: 'lift-off',
        material: '2 mm greyboard wrapped in textured paper',
        description: 'A clean, sturdy square box with a lift-off lid. The everyday premium choice.',
        sizes: { s: 320, m: 420, l: 540 },
        colours: {
          exterior: ['black', 'ivory', 'navy', 'forest', 'burgundy', 'blush', 'sage'],
          interior: ['ivory', 'black', 'gold', 'blush'],
          lid: ['black', 'ivory', 'navy', 'forest', 'burgundy', 'blush', 'sage', 'gold']
        },
        linings: [
          { id: 'paper', label: 'Paper-lined', price: 0 },
          { id: 'suede', label: 'Suede-feel lining', price: 90 }
        ],
        texture: 'paper', available: true, model: null
      },
      {
        id: 'rect-rigid', name: 'Rectangular rigid box', shape: 'rect', lid: 'lift-off',
        material: '2 mm greyboard wrapped in textured paper',
        description: 'Long format with room for bottles, notebooks and apparel side by side.',
        sizes: { s: 340, m: 450, l: 580, xl: 720 },
        colours: {
          exterior: ['black', 'ivory', 'navy', 'forest', 'burgundy', 'beige', 'blush'],
          interior: ['ivory', 'black', 'gold', 'beige'],
          lid: ['black', 'ivory', 'navy', 'forest', 'burgundy', 'beige', 'blush', 'gold']
        },
        linings: [
          { id: 'paper', label: 'Paper-lined', price: 0 },
          { id: 'suede', label: 'Suede-feel lining', price: 90 }
        ],
        texture: 'paper', available: true, model: null
      },
      {
        id: 'round-hatbox', name: 'Round hat box', shape: 'round', lid: 'lift-off',
        material: 'Rigid board drum with a lift-off lid',
        description: 'A soft, celebratory silhouette. Good for festive and wedding gifting.',
        sizes: { s: 380, m: 490, l: 620 },
        colours: {
          exterior: ['ivory', 'blush', 'black', 'navy', 'burgundy', 'sage'],
          interior: ['ivory', 'gold', 'blush'],
          lid: ['ivory', 'blush', 'black', 'navy', 'burgundy', 'sage', 'gold']
        },
        linings: [{ id: 'paper', label: 'Paper-lined', price: 0 }],
        texture: 'paper', available: true, model: null
      },
      {
        id: 'magnetic', name: 'Magnetic closure box', shape: 'rect', lid: 'magnetic',
        material: 'Rigid board with a hinged magnetic flap',
        description: 'Opens like a book and closes with a soft magnetic click.',
        sizes: { m: 520, l: 660, xl: 820 },
        colours: {
          exterior: ['black', 'navy', 'forest', 'burgundy', 'ivory'],
          interior: ['ivory', 'black', 'gold'],
          lid: ['black', 'navy', 'forest', 'burgundy', 'ivory']
        },
        linings: [
          { id: 'paper', label: 'Paper-lined', price: 0 },
          { id: 'suede', label: 'Suede-feel lining', price: 90 }
        ],
        texture: 'paper', available: true, model: null
      },
      {
        id: 'luxury', name: 'Premium luxury gift box', shape: 'rect', lid: 'lift-off',
        material: 'Linen-wrapped rigid board with a ribbon pull',
        description: 'Our heaviest box: linen finish, deep lid and a satin pull tab.',
        sizes: { m: 780, l: 960, xl: 1180 },
        colours: {
          exterior: ['black', 'navy', 'forest', 'burgundy', 'ivory'],
          interior: ['ivory', 'gold', 'black', 'burgundy'],
          lid: ['black', 'navy', 'forest', 'burgundy', 'ivory', 'gold']
        },
        linings: [
          { id: 'suede', label: 'Suede-feel lining', price: 0 },
          { id: 'satin', label: 'Satin lining', price: 120 }
        ],
        texture: 'linen', available: true, model: null
      },
      {
        id: 'wooden', name: 'Pine wood crate', shape: 'rect', lid: 'sliding',
        material: 'Solid pine with a sliding lid',
        description: 'A keepsake crate people reuse long after the gift is gone.',
        sizes: { m: 690, l: 850, xl: 1040 },
        colours: {
          exterior: ['pine', 'walnut', 'whitewash'],
          interior: ['pine', 'walnut', 'whitewash'],
          lid: ['pine', 'walnut', 'whitewash']
        },
        linings: [{ id: 'bare', label: 'Bare wood', price: 0 }],
        texture: 'wood', available: true, model: null
      },
      {
        id: 'jute-basket', name: 'Woven jute basket', shape: 'basket', lid: 'none',
        material: 'Hand-woven jute with cane handles',
        description: 'Open and generous. Best when the contents should be seen.',
        sizes: { s: 300, m: 380, l: 480 },
        colours: { exterior: ['jute', 'black', 'ivory'], interior: ['jute', 'black', 'ivory'], lid: [] },
        linings: [{ id: 'none', label: 'Unlined', price: 0 }],
        texture: 'weave', available: true, model: null
      },
      {
        id: 'canvas-bag', name: 'Canvas hamper bag', shape: 'bag', lid: 'none',
        material: 'Heavy cotton canvas with rope handles',
        description: 'Soft-sided and reusable. Not suitable for glass or ceramics.',
        sizes: { m: 260, l: 340 },
        dims: { m: [32, 14, 30], l: [40, 16, 36] },
        capacity: { m: 8, l: 12 },
        colours: { exterior: ['ivory', 'beige', 'navy', 'forest', 'black'], interior: ['ivory', 'beige', 'navy', 'forest', 'black'], lid: [] },
        linings: [{ id: 'none', label: 'Unlined', price: 0 }],
        texture: 'canvas', available: true, softSided: true, model: null
      },
      {
        id: 'eco-kraft', name: 'Recycled kraft box', shape: 'rect', lid: 'lift-off',
        material: '100% recycled kraft board, plastic-free',
        description: 'Fully recyclable packaging with a natural, honest finish.',
        sizes: { s: 220, m: 290, l: 370 },
        colours: { exterior: ['kraft', 'white'], interior: ['kraft', 'white'], lid: ['kraft', 'white'] },
        linings: [{ id: 'none', label: 'Unlined', price: 0 }],
        texture: 'kraft', available: true, eco: true, model: null
      }
    ],

    /* price = base price for a Small box; multiplied by the size's fillFactor. */
    fillings: [
      { id: 'shred', name: 'Shredded paper', texture: 'shred', price: 40, colours: ['ivory', 'kraft', 'gold', 'blush', 'sage', 'black', 'red'], description: 'Fine paper strands. The classic hamper bed.' },
      { id: 'crinkle', name: 'Crinkle-cut paper', texture: 'crinkle', price: 55, colours: ['kraft', 'ivory', 'gold', 'burgundy', 'navy', 'blush'], description: 'Springy zig-zag strips that hold products upright.' },
      { id: 'tissue', name: 'Tissue paper nest', texture: 'tissue', price: 45, colours: ['white', 'ivory', 'blush', 'sky', 'black', 'gold'], description: 'Soft folded sheets for a wrapped, layered look.' },
      { id: 'fabric', name: 'Cotton fabric lining', texture: 'fabric', price: 90, colours: ['ivory', 'beige', 'forest', 'navy'], description: 'A draped cotton bed. Reusable as a napkin or wrap.' },
      { id: 'satin', name: 'Satin-finish lining', texture: 'satin', price: 130, colours: ['ivory', 'gold', 'burgundy', 'black', 'blush'], description: 'A glossy draped finish for premium and wedding boxes.' },
      { id: 'jute', name: 'Jute fibre bed', texture: 'jute', price: 60, colours: ['jute'], description: 'Natural fibre filling. Biodegradable.' },
      { id: 'cushion', name: 'Recyclable honeycomb cushioning', texture: 'honeycomb', price: 50, colours: ['kraft', 'white'], description: 'Protective paper honeycomb. Plastic-free.' },
      { id: 'none', name: 'No filling', texture: 'none', price: 0, colours: [], description: 'Products sit directly on the box base.' }
    ],

    categories: [
      { id: 'drinkware', label: 'Drinkware' },
      { id: 'stationery', label: 'Stationery' },
      { id: 'lifestyle', label: 'Lifestyle' },
      { id: 'gourmet', label: 'Gourmet' },
      { id: 'care', label: 'Personal care' },
      { id: 'corporate', label: 'Corporate & institutional' },
      { id: 'premium', label: 'Premium additions' }
    ],

    /* Personalisation methods. Charge is per personalised item.
     * A product lists which methods it supports and (optionally) its own price. */
    methods: {
      print:     { label: 'Printing',      charge: 50 },
      engrave:   { label: 'Laser engraving', charge: 90 },
      embroider: { label: 'Embroidery',    charge: 120 },
      foil:      { label: 'Foil stamping', charge: 70 },
      emboss:    { label: 'Debossing',     charge: 80 },
      label:     { label: 'Printed label', charge: 30 }
    },

    fonts: [
      { id: 'serif',  label: 'Classic serif', css: "'Cormorant', Georgia, serif" },
      { id: 'sans',   label: 'Modern sans',   css: "'Manrope', 'Segoe UI', sans-serif" },
      { id: 'script', label: 'Script',        css: "'Pinyon Script', 'Brush Script MT', cursive" }
    ],
    textColours: ['gold', 'white', 'black', 'silver', 'terracotta', 'navy'],

    /*
     * Products.
     *  price      unit price (demo)
     *  volume     space used in the box per unit (compare with size capacity)
     *  dims       [width, height] in cm, used to draw it in the preview
     *  icon       drawing used in the preview until a product photo/model is added
     *  image      optional product photo URL (shown on the product card)
     *  colours    allowed colours ([] = fixed packaging, no choice)
     *  variants   optional size list, e.g. T-shirt sizes; variantPrices adds to price
     *  personal   { methods: [...], fields: [...], maxChars, placements } or null
     *  maxPerHamper, stock (null = not tracked), minSize, fragile, perishable
     */
    products: [
      // Drinkware
      { id: 'steel-bottle', category: 'drinkware', name: 'Insulated steel bottle, 750 ml', description: 'Keeps drinks cold for hours. Engraves beautifully.', price: 549, volume: 2, dims: [7, 26], icon: 'bottle', colours: ['black', 'white', 'navy', 'forest', 'blush', 'steel'], personal: { methods: ['engrave', 'print'], fields: ['text', 'logo'], maxChars: 18, placements: ['Front', 'Back'] }, maxPerHamper: 4, stock: null },
      { id: 'flask', category: 'drinkware', name: 'Premium vacuum flask, 500 ml', description: 'Brushed finish with a cup lid.', price: 799, volume: 2, dims: [7, 24], icon: 'flask', colours: ['black', 'steel', 'navy', 'burgundy'], personal: { methods: ['engrave'], fields: ['text', 'logo'], maxChars: 18, placements: ['Front', 'Back'] }, maxPerHamper: 4, stock: null },
      { id: 'mug', category: 'drinkware', name: 'Ceramic coffee mug, 330 ml', description: 'Glazed stoneware for the desk.', price: 299, volume: 2, dims: [12, 10], icon: 'mug', colours: ['white', 'black', 'ivory', 'navy', 'sage'], personal: { methods: ['print'], fields: ['text', 'logo'], maxChars: 24, placements: ['Front', 'Wrap-around'] }, maxPerHamper: 4, stock: null, fragile: true },
      { id: 'travel-mug', category: 'drinkware', name: 'Travel mug with lid, 400 ml', description: 'Leak-resistant lid for the commute.', price: 449, volume: 2, dims: [9, 17], icon: 'travelmug', colours: ['black', 'white', 'sage', 'navy'], personal: { methods: ['print', 'engrave'], fields: ['text', 'logo'], maxChars: 18, placements: ['Front'] }, maxPerHamper: 4, stock: null },
      { id: 'tumbler', category: 'drinkware', name: 'Double-wall tumbler, 450 ml', description: 'Steel tumbler with a slide lid.', price: 499, volume: 2, dims: [9, 16], icon: 'tumbler', colours: ['steel', 'black', 'white', 'blush', 'forest'], personal: { methods: ['engrave'], fields: ['text', 'logo'], maxChars: 18, placements: ['Front'] }, maxPerHamper: 4, stock: null },

      // Stationery
      { id: 'notebook', category: 'stationery', name: 'Hardbound notebook', description: 'Lay-flat binding, 192 ruled pages.', price: 349, volume: 2, dims: [15, 21], icon: 'notebook', colours: ['black', 'navy', 'forest', 'burgundy', 'beige', 'blush'], variants: ['A5', 'B5'], variantPrices: { B5: 60 }, personal: { methods: ['foil', 'emboss', 'print'], fields: ['text', 'logo'], maxChars: 24, placements: ['Cover centre', 'Cover bottom-right'] }, maxPerHamper: 4, stock: null },
      { id: 'journal', category: 'stationery', name: 'Vegan-leather journal', description: 'Soft-touch cover with an elastic band.', price: 649, volume: 2, dims: [14, 20], icon: 'journal', colours: ['black', 'burgundy', 'navy', 'beige'], personal: { methods: ['foil', 'emboss'], fields: ['text', 'logo'], maxChars: 20, placements: ['Cover centre', 'Cover bottom-right'] }, maxPerHamper: 3, stock: null },
      { id: 'pen', category: 'stationery', name: 'Metal ballpoint pen', description: 'Weighted metal body, blue ink.', price: 149, volume: 0.5, dims: [1.6, 14], icon: 'pen', colours: ['black', 'navy', 'silver', 'gold', 'burgundy'], personal: { methods: ['engrave', 'print'], fields: ['text'], maxChars: 16, placements: ['Barrel'] }, maxPerHamper: 6, stock: null },
      { id: 'pen-set', category: 'stationery', name: 'Pen and pencil gift set', description: 'Matching pair in a slim case.', price: 699, volume: 1, dims: [6, 17], icon: 'penset', colours: ['black', 'navy'], personal: { methods: ['engrave'], fields: ['text'], maxChars: 16, placements: ['Case lid'] }, maxPerHamper: 2, stock: null },
      { id: 'desk-organiser', category: 'stationery', name: 'Wooden desk organiser', description: 'Pen cup, card slot and phone stand in one.', price: 599, volume: 4, dims: [18, 11], icon: 'organiser', colours: ['pine', 'walnut'], personal: { methods: ['engrave'], fields: ['text', 'logo'], maxChars: 20, placements: ['Front'] }, maxPerHamper: 1, stock: null, minSize: 'm' },
      { id: 'sticky-notes', category: 'stationery', name: 'Sticky note set', description: 'Three pads in a card wrap.', price: 129, volume: 0.5, dims: [9, 9], icon: 'sticky', colours: ['ivory', 'blush', 'sky', 'sage'], personal: { methods: ['print'], fields: ['logo'], maxChars: 0, placements: ['Wrap'] }, maxPerHamper: 4, stock: null },
      { id: 'planner', category: 'stationery', name: 'Undated weekly planner', description: 'A full year of weekly spreads.', price: 399, volume: 2, dims: [15, 21], icon: 'planner', colours: ['black', 'sage', 'blush', 'navy'], personal: { methods: ['foil'], fields: ['text', 'logo'], maxChars: 20, placements: ['Cover'] }, maxPerHamper: 2, stock: null },

      // Lifestyle
      { id: 'tote', category: 'lifestyle', name: 'Cotton canvas tote bag', description: 'Heavy canvas with an inner pocket. Packed folded.', price: 299, volume: 1, dims: [16, 18], icon: 'tote', colours: ['ivory', 'beige', 'black', 'navy', 'forest'], personal: { methods: ['print', 'embroider'], fields: ['text', 'logo'], maxChars: 24, placements: ['Front centre', 'Front bottom'] }, maxPerHamper: 2, stock: null },
      { id: 'keychain', category: 'lifestyle', name: 'Leather keychain', description: 'Full-grain leather with a brass ring.', price: 179, volume: 0.5, dims: [4, 10], icon: 'keychain', colours: ['walnut', 'black', 'burgundy'], personal: { methods: ['engrave', 'emboss'], fields: ['text'], maxChars: 6, placements: ['Front'] }, maxPerHamper: 4, stock: null },
      { id: 'bookmark', category: 'lifestyle', name: 'Brass bookmark', description: 'Etched brass with a tassel.', price: 249, volume: 0.5, dims: [3, 12], icon: 'bookmark', colours: ['gold', 'silver'], personal: { methods: ['engrave'], fields: ['text'], maxChars: 14, placements: ['Front'] }, maxPerHamper: 4, stock: null },
      { id: 'tshirt', category: 'lifestyle', name: 'Cotton crew T-shirt', description: '180 GSM combed cotton, packed folded.', price: 449, volume: 2, dims: [18, 12], icon: 'tshirt', colours: ['white', 'black', 'navy', 'forest', 'beige'], variants: ['S', 'M', 'L', 'XL', 'XXL'], personal: { methods: ['print', 'embroider'], fields: ['text', 'logo'], maxChars: 24, placements: ['Chest left', 'Chest centre', 'Back'] }, maxPerHamper: 2, stock: null, minSize: 'm' },
      { id: 'cap', category: 'lifestyle', name: 'Six-panel cotton cap', description: 'Adjustable strap, curved peak.', price: 349, volume: 2.5, dims: [18, 11], icon: 'cap', colours: ['black', 'navy', 'beige', 'forest'], personal: { methods: ['embroider'], fields: ['text', 'logo'], maxChars: 14, placements: ['Front panel', 'Side'] }, maxPerHamper: 2, stock: null, minSize: 'm' },

      // Gourmet
      { id: 'chocolates', category: 'gourmet', name: 'Assorted chocolate box, 12 pieces', description: 'Handmade assortment in a rigid sleeve.', price: 499, volume: 2, dims: [16, 10], icon: 'chocobox', colours: ['gold', 'burgundy', 'ivory'], personal: { methods: ['label'], fields: ['text', 'logo'], maxChars: 24, placements: ['Sleeve'] }, maxPerHamper: 3, stock: null, perishable: true },
      { id: 'cookies', category: 'gourmet', name: 'Butter cookie jar, 250 g', description: 'Glass jar with a cork lid.', price: 349, volume: 2, dims: [10, 13], icon: 'cookiejar', colours: [], personal: { methods: ['label'], fields: ['text', 'logo'], maxChars: 20, placements: ['Lid label'] }, maxPerHamper: 3, stock: null, perishable: true, fragile: true },
      { id: 'nut-mix', category: 'gourmet', name: 'Roasted nut and seed mix, 200 g', description: 'Lightly salted, resealable pouch.', price: 299, volume: 1.5, dims: [12, 17], icon: 'pouch', colours: [], personal: null, maxPerHamper: 3, stock: null, perishable: true },
      { id: 'tea', category: 'gourmet', name: 'Loose-leaf tea tin, 100 g', description: 'Single-estate black tea in a keepsake tin.', price: 399, volume: 1.5, dims: [8, 12], icon: 'teatin', colours: ['navy', 'forest', 'burgundy', 'ivory'], personal: { methods: ['label'], fields: ['text', 'logo'], maxChars: 20, placements: ['Tin front'] }, maxPerHamper: 3, stock: null, perishable: true },
      { id: 'coffee', category: 'gourmet', name: 'Ground coffee pouch, 250 g', description: 'Medium roast, filter grind.', price: 449, volume: 1.5, dims: [11, 18], icon: 'coffeebag', colours: ['kraft', 'black'], personal: { methods: ['label'], fields: ['text', 'logo'], maxChars: 20, placements: ['Front label'] }, maxPerHamper: 3, stock: null, perishable: true },

      // Personal care
      { id: 'hand-cream', category: 'care', name: 'Hand cream, 50 ml', description: 'Shea butter tube, light fragrance.', price: 349, volume: 0.5, dims: [4, 14], icon: 'tube', colours: [], personal: null, maxPerHamper: 3, stock: null },
      { id: 'moisturiser', category: 'care', name: 'Face moisturiser jar, 50 g', description: 'Everyday hydration in a glass jar.', price: 549, volume: 1, dims: [7, 6], icon: 'jar', colours: [], personal: null, maxPerHamper: 2, stock: null, fragile: true },
      { id: 'self-care-kit', category: 'care', name: 'Self-care kit', description: 'Eye mask, lip balm and soap in a cotton pouch.', price: 799, volume: 3, dims: [18, 13], icon: 'carekit', colours: ['blush', 'sage', 'ivory'], personal: { methods: ['embroider', 'print'], fields: ['text'], maxChars: 12, placements: ['Pouch front'] }, maxPerHamper: 1, stock: null, minSize: 'm' },
      { id: 'candle', category: 'care', name: 'Soy candle in glass, 180 g', description: 'Hand-poured, about 35 hours of burn.', price: 449, volume: 1.5, dims: [8, 9], icon: 'candle', colours: ['ivory', 'sage', 'blush'], personal: { methods: ['label'], fields: ['text', 'logo'], maxChars: 20, placements: ['Front label'] }, maxPerHamper: 2, stock: null, fragile: true },

      // Corporate & institutional
      { id: 'lanyard', category: 'corporate', name: 'Printed lanyard with ID holder', description: 'Polyester strap with a safety clip.', price: 149, volume: 0.5, dims: [6, 12], icon: 'lanyard', colours: ['navy', 'black', 'red', 'forest'], personal: { methods: ['print'], fields: ['text', 'logo'], maxChars: 24, placements: ['Strap'] }, maxPerHamper: 2, stock: null },
      { id: 'conference-folder', category: 'corporate', name: 'Conference folder with notepad', description: 'Card folder with an A5 pad and pen loop.', price: 349, volume: 2, dims: [16, 22], icon: 'folder', colours: ['navy', 'black', 'forest'], personal: { methods: ['print', 'foil'], fields: ['text', 'logo'], maxChars: 30, placements: ['Cover'] }, maxPerHamper: 2, stock: null },
      { id: 'usb-drive', category: 'corporate', name: 'Metal USB drive, 16 GB', description: 'Swivel cap with a key ring.', price: 399, volume: 0.5, dims: [2, 6], icon: 'usb', colours: ['silver', 'black'], personal: { methods: ['engrave'], fields: ['text', 'logo'], maxChars: 12, placements: ['Cap'] }, maxPerHamper: 2, stock: null },
      { id: 'student-pack', category: 'corporate', name: 'Student welcome pack', description: 'Notebook, pen and sticker sheet in a sleeve.', price: 399, volume: 3, dims: [16, 22], icon: 'kit', colours: ['navy', 'forest', 'burgundy'], personal: { methods: ['print'], fields: ['text', 'logo'], maxChars: 30, placements: ['Sleeve'] }, maxPerHamper: 1, stock: null },
      { id: 'welcome-card', category: 'corporate', name: 'Welcome insert card, A6', description: 'A printed welcome note from your team.', price: 49, volume: 0.25, dims: [10, 15], icon: 'card', colours: ['ivory', 'white'], personal: { methods: ['print'], fields: ['text', 'logo'], maxChars: 60, placements: ['Front'] }, maxPerHamper: 1, stock: null },

      // Premium additions
      { id: 'coaster-set', category: 'premium', name: 'Brass coaster set of 4', description: 'Etched brass with cork backs.', price: 599, volume: 1, dims: [10, 10], icon: 'coaster', colours: ['gold'], personal: { methods: ['engrave'], fields: ['text', 'logo'], maxChars: 10, placements: ['Top'] }, maxPerHamper: 1, stock: null },
      { id: 'photo-frame', category: 'premium', name: 'Photo frame, 5 × 7 in', description: 'Solid wood frame with glass front.', price: 449, volume: 2, dims: [15, 20], icon: 'frame', colours: ['walnut', 'black', 'white'], personal: { methods: ['engrave'], fields: ['text'], maxChars: 24, placements: ['Bottom rail'] }, maxPerHamper: 1, stock: null, fragile: true },
      { id: 'brass-diya', category: 'premium', name: 'Brass diya', description: 'Hand-finished brass lamp for festive boxes.', price: 349, volume: 1, dims: [9, 6], icon: 'diya', colours: ['gold'], personal: null, maxPerHamper: 2, stock: null },
      { id: 'keepsake-box', category: 'premium', name: 'Wooden keepsake box', description: 'A small hinged box for jewellery or notes.', price: 549, volume: 1.5, dims: [11, 7], icon: 'keepsake', colours: ['walnut', 'pine'], personal: { methods: ['engrave'], fields: ['text'], maxChars: 16, placements: ['Lid'] }, maxPerHamper: 1, stock: null }
    ],

    /*
     * Finishing touches.
     *  group: options in the same exclusive group replace each other
     *  shapes: box shapes it works with (omit = all)
     *  requires: id of a group that must be selected first
     *  colours: optional colour choice (ribbons)
     */
    finishing: [
      { id: 'ribbon-satin', name: 'Satin ribbon', description: 'A smooth band tied around the box.', price: 40, group: 'ribbon', colours: ['ivory', 'gold', 'burgundy', 'navy', 'forest', 'blush', 'black', 'red'], icon: 'ribbon' },
      { id: 'ribbon-grosgrain', name: 'Grosgrain ribbon', description: 'A ribbed, matte ribbon with more body.', price: 50, group: 'ribbon', colours: ['ivory', 'navy', 'forest', 'black', 'terracotta'], icon: 'ribbon' },
      { id: 'bow', name: 'Hand-tied bow', description: 'A full bow on top of your ribbon.', price: 35, requires: 'ribbon', icon: 'bow' },
      { id: 'wrap-premium', name: 'Premium paper wrap', description: 'The whole box wrapped in textured paper.', price: 80, group: 'wrap', shapes: ['square', 'rect', 'round'], icon: 'wrap' },
      { id: 'wrap-clear', name: 'Transparent wrap', description: 'Clear wrap gathered at the top, so the contents show.', price: 45, group: 'wrap', icon: 'clearwrap' },
      { id: 'gift-tag', name: 'Kraft gift tag', description: 'A hanging tag with the recipient name.', price: 20, icon: 'tag' },
      { id: 'card-greeting', name: 'Greeting card', description: 'A folded card printed with your greeting.', price: 60, group: 'card', icon: 'card' },
      { id: 'card-thanks', name: 'Thank-you card', description: 'A folded thank-you card.', price: 60, group: 'card', icon: 'card' },
      { id: 'card-message', name: 'Custom message card', description: 'Prints your personal message in full.', price: 75, group: 'card', icon: 'card' },
      { id: 'sleeve', name: 'Printed box sleeve', description: 'A paper band around the box, printed with your text or logo.', price: 110, shapes: ['square', 'rect'], icon: 'sleeve' },
      { id: 'seal-stickers', name: 'Branded seal stickers', description: 'Two round stickers that seal the box or wrap.', price: 30, icon: 'sticker' },
      { id: 'wax-seal', name: 'Wax seal', description: 'A hand-pressed wax seal on the lid.', price: 45, shapes: ['square', 'rect', 'round'], icon: 'wax' },
      { id: 'foil-edge', name: 'Gold foil edge', description: 'Gold foil along the lid edges. Rigid boxes only.', price: 150, boxes: ['square-rigid', 'rect-rigid', 'round-hatbox', 'magnetic', 'luxury'], icon: 'foil' }
    ],

    /* Box-level personalisation charges (per hamper). */
    hamperPersonal: {
      printCharge: 60,      // text printed on the lid, front or sleeve
      logoCharge: 120,      // logo printed on the box
      ribbonPrintCharge: 40,
      placements: [
        { id: 'lid', label: 'Lid top' },
        { id: 'front', label: 'Box front' },
        { id: 'sleeve', label: 'Box sleeve', requiresFinishing: 'sleeve' },
        { id: 'tag', label: 'Gift tag', requiresFinishing: 'gift-tag' }
      ],
      limits: { name: 30, company: 40, event: 40, greeting: 40, tagline: 40, message: 300, ribbonText: 24 },
      logo: { maxBytes: 2 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] }
    },

    defaults: {
      boxId: 'square-rigid', size: 'm', fillingId: 'shred'
    }
  };

  return catalogue;
});
