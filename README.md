# KORE Gifting Studio · Vercel project

The complete website, ready to push to GitHub and deploy on Vercel.

| Page | URL | File |
|---|---|---|
| Cinematic homepage (3D scroll film, occasions, corporate gifting, studio, enquiry form) | `/` | `public/index.html` |
| Customize Your Hamper (step-by-step builder with live 3D preview and pricing) | `/customize-hamper` | `public/customize-hamper.html` |
| Not-found page | any unknown URL | `public/404.html` |

## What it is built with

Plain HTML, CSS and vanilla JavaScript, with Three.js r147 (a copy is included in `public/vendor/three/`, with a pinned CDN copy as a backup). There is no React, Next.js or bundler, so nothing is compiled. Vercel serves `public/` as static files and runs the two small functions in `api/`.

```
public/            the website (served as-is)
  index.html, home.css, home.js, home-scene.js, home-config.js
  customize-hamper.html/.css/.js, hamper-*.js (catalogue, pricing, 3D preview, config)
  img/             17 WebP images        vendor/three/  Three.js r147 + MIT licence
  404.html, favicon.svg, robots.txt
api/               Vercel serverless functions
  orders.js        POST /api/orders      (builder quotation request)
  enquiries.js     POST /api/enquiries   (homepage enquiry form)
lib/               code the functions share (Redis storage, request handling)
server/            order/enquiry logic (also a tiny Node server for local work or self-hosting)
scripts/           verify-site.js (pre-deploy check, npm run check), export-orders.js
tests/             35 automated tests
vercel.json        clean URLs, headers (no per-function settings: Vercel finds api/*.js by itself)
.env.example       every environment variable, with notes
docs/FEATURES.md   how the builder, pricing and 3D film work
```

## Deploy in about ten minutes

1. **Put it on GitHub.** The repository root must contain the project's files and folders directly, not a folder that holds them. After unzipping, you should see `vercel.json`, `package.json`, `public/`, `api/` and the rest at the top level. Then either:
   - **with git**, from inside the unzipped folder: `git init && git add . && git commit -m "KORE website" && git branch -M main && git remote add origin <your-repo-url> && git push -u origin main` (or, for an existing repository, `git add -A && git commit -m "Add full website" && git push`); or
   - **on github.com**, open the repository, choose Add file → Upload files, and drag in everything from inside the unzipped folder (every folder and file, not the folder itself). If the page limits how many files one upload can take, upload in batches.
   After it finishes, the repository's first page must show `public/`, `api/`, `lib/`, `server/`, `scripts/`, `tests/` and `docs/` alongside `vercel.json`.
2. **Import into Vercel.** Vercel dashboard → Add New → Project → pick the repository → Deploy. Leave every setting as it is. There is no compile step: `vercel.json` sets the output folder (`public`) and clean URLs, and Vercel serves the files as they are. Its build command only checks that `public/index.html` exists, so a repository that is missing the website fails with a clear error instead of deploying a blank site. The first deploy gives you a `.vercel.app` address.
3. **Open it and try it.** At this point the whole site works (see "How orders and enquiries reach you").
4. **Optional, to also save orders and email KORE automatically:** do the two steps in the next section, then redeploy once (Deployments → latest → Redeploy).
5. **Custom domain.** Project → Settings → Domains.

## How orders and enquiries reach you

There are two layers, and the second is optional.

**Layer 1: the email draft (works immediately, no setup).** Pressing **Send quotation request** (builder) or **Get My Free Mockup** (homepage) opens a Gmail compose tab addressed to `koreexpression@gmail.com` with the visitor's whole order or enquiry typed out. The result also offers "Open in your email app" and, in the builder, "Copy email text". A website cannot send an email by itself, so the visitor presses Send in that draft. A logo cannot be attached automatically; the email names the file and the page reminds the visitor to attach it.

**Layer 2: saved orders and automatic emails (needs a database and an email service).** When these are connected, every request is also re-priced on the server (the browser's prices are never trusted), saved, and emailed to KORE with the logo attached, and the customer gets an acknowledgement. Until they are connected the API answers "not set up" and the pages quietly stay on layer 1.

1. **Database.** Vercel project → Storage → Create → *Upstash Redis* (Marketplace) → connect it to this project. It adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the older `KV_REST_API_URL` and `KV_REST_API_TOKEN`; both are understood). Check the names under Settings → Environment Variables.
2. **Email.** Create a free account at [resend.com](https://resend.com), verify your domain, create an API key, then add these in Settings → Environment Variables:

| Variable | Meaning |
|---|---|
| `RESEND_API_KEY` | Resend API key (secret, server only) |
| `FROM_EMAIL` | Sender on your verified domain, e.g. `KORE Gifting Studio <orders@yourdomain.in>` |
| `BUSINESS_EMAIL` | Where new orders and enquiries go, e.g. `koreexpression@gmail.com` (comma-separate several) |
| `SEND_CUSTOMER_ACK` | `true` or `false`: also email the customer an acknowledgement |

All secrets stay on the server. Nothing in `public/` contains a key, and `.env*` files are git-ignored.

**Reading saved orders.** In the Upstash console use the Data Browser (keys `kore:order:*` and `kore:enquiry:*`), or from your computer run `vercel env pull .env.local`, load it into your shell, then `npm run export-orders > orders.json`. To resend notification emails that failed, run `npm run retry-emails` the same way (`-- --list` only lists them).

**Limits to know about.**
- Logos up to about 0.7 MB are stored in Redis as well as emailed. Larger logos (up to the 2 MB limit) are delivered only as the email attachment, so with a database but no email service a large logo is refused with a "try again" message.
- Requests are limited to 10 per visitor per 10 minutes.
- There is no login or admin screen. Orders are read through Upstash, the export script or the emails.

## If a deploy fails

| Message | Cause and fix |
|---|---|
| `The pattern "api/*.js" defined in functions doesn't match any Serverless Functions inside the api directory` | An older `vercel.json` listed `api/*.js` under `functions`, but the deployed commit had no `api/orders.js` and `api/enquiries.js` (the folder was not uploaded to GitHub, or it sits inside another folder). The current `vercel.json` has no `functions` block, so this error can no longer happen. To get the saving API, make sure `api/`, `lib/` and `server/` are in the repository root on GitHub next to `public/` and `vercel.json`. |
| `ENOENT: no such file or directory, access 'public/index.html'` | The repository does not contain the `public/` folder, so there is no homepage to publish. Upload the whole project (see "Put it on GitHub" below) so that `public/`, `api/`, `lib/`, `server/`, `scripts/` and `tests/` sit next to `vercel.json` in the repository root. |
| `Cannot find module '.../scripts/verify-site.js'` | Older versions had a build step that ran this file on Vercel. The current `vercel.json` and `package.json` no longer run it on Vercel, so this error should not appear after you push the new files. If it does, `package.json` still has a `"build"` script: replace it with the current `package.json`. |
| `Site check failed: ...` (only when you run `npm run check` yourself) | A file that a page or script links to is missing from the repository, or a script does not parse. The message names the file. |
| `api/orders.js: Cannot find module ...` | `api/` is in the repository but `lib/` or `server/` is not. Upload them too. |
| The site deploys but a request to `/` or `/customize-hamper` gives 404 | Vercel's Root Directory setting points at the wrong folder. Settings → General → Root Directory must be the folder that contains `vercel.json` and `public/`. |

The API is optional. Without `api/` the site deploys as a static site and the final buttons still open the ready-to-send email draft; with it (and the database variables) orders are also saved.

## Logo

The KORE Gifting Studios logo is `public/img/kore-logo.png` (gold on transparent, 1200 px wide). It is used in the homepage navigation and footer, the builder header (`logoSrc` in `public/hamper-config.js`), the portfolio page and the 404 page, and it is printed on the lid of the 3D gift box (`home-scene.js` loads the same file). The browser icon (`favicon.svg`, `favicon.png`, `apple-touch-icon.png`) uses the O-and-arc mark from the logo. The still images in `public/img/film-*.webp` and `craft-ribbon.webp` were re-rendered with the new lid.

To change the logo later, replace `public/img/kore-logo.png` with a file of the same shape (about 5.4 : 1).

## Portfolio page

`public/portfolio.html` is the client portfolio, served at `/portfolio`. It ships with no client names, case studies or reviews, and says so on the page.

To add a real case study or review, edit the `window.KORE_PORTFOLIO` block at the bottom of the file, following the example in its comment. Add an entry only when the client has approved the name, the write-up and the quote in writing. An entry with `permission` not set to `true` is never shown.

To link the portfolio from the homepage, add `<a href="/portfolio">Portfolio</a>` to the navigation in `public/index.html`.

## Changing addresses and settings

| What | Where |
|---|---|
| Order email address | `orderEmail` in `public/hamper-config.js` |
| Enquiry email address | `enquiryEmail` in `public/home-config.js` |
| Phone and WhatsApp | `public/index.html` (search `919606993969`) |
| Products, prices, colours, boxes | `public/hamper-catalogue.js` (prices there are placeholder rates until KORE confirms them) |
| Where "Customize Your Hamper" links | `builderHref` in `public/home-config.js` |

## Run it on your computer

```
npm run dev      # http://localhost:8080  (site + API, orders saved to ./data, nothing to install)
npm test         # 35 tests, including the API against a fake Redis and fake Resend
npm run check    # pre-deploy check: every referenced file exists, every script parses, API loads (Vercel does not run it)
```

Node 22 is expected (`engines` in `package.json`). The Vercel CLI's `vercel dev` is another option (not tested here).

## The Claude artifacts

The site was built in Claude and published there as separate artifacts. This folder contains the source code of what they show; nothing in it embeds a claude.ai URL.

| Artifact | What it is | In this project |
|---|---|---|
| Homepage (`claude.ai/artifact/KhfQSywgM8DKAbeZwE5xSR`) | The cinematic homepage | Implemented as `public/index.html`, `home.css`, `home.js`, `home-scene.js`, `home-config.js`. Not iframed. |
| Hamper builder (`claude.ai/artifact/QYRATqgBtZCwk63fcCiL1h`) | Customize Your Hamper | Implemented as `public/customize-hamper.*` and `hamper-*.js`. Not iframed. |
| Design canvas (`claude.ai/artifact/UweTydrGopF7skxqUwrLEq`) | The editable design board for the homepage | **Not included.** It is a design source that lives in Claude Design; the live code above is the finished result. |

Differences from the artifact versions, none visual:

- The artifacts link to each other with claude.ai addresses. Here the links are ordinary site links (`/customize-hamper`, `/#enquiry`).
- The artifacts save orders into Claude's built-in artifact database and show an owner-only "Order inbox" / "Enquiries inbox" button. That database and sign-in only exist inside Claude, so they cannot be exported. On Vercel the `api/` functions with Redis do that job instead, and those two inbox buttons stay hidden.

The two client-portfolio PDFs made earlier are separate files and are not part of the website. To offer them for download, put them in `public/` and link to them.

## Things that stay external or are still placeholders

- **Google Fonts** (Cormorant, Manrope, Poppins, Pinyon Script) are loaded from Google. If you prefer, self-host them to remove that third-party request.
- **Gmail and WhatsApp** open in the visitor's browser. The email draft opens Gmail's web compose window; people who do not use Gmail can use the "Open in your email app" link.
- **Real content still to supply:** product photos and prices (the 3D products are generated models with sample names), the studio photo at a higher resolution, the corporate price table, and GLB models if you want the 3D film to show your exact products. See `docs/FEATURES.md`.
- **Vercel plan.** Vercel's free Hobby plan is meant for personal, non-commercial use; check Vercel's current terms and use a paid plan for a business site.
