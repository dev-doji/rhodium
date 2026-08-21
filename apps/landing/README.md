# Rhodium — landing page

Next.js (App Router) + Tailwind CSS v4. Statically exported, so it can be hosted
anywhere that serves files — Vercel, Netlify, Cloudflare Pages, S3, or the same
box as the API.

```bash
npm install          # from this directory (or: npm run landing:install at the repo root)
npm run dev          # http://localhost:3001
npm run build        # static site → ./out
```

Port 3001 is deliberate: the API dev server already owns 3000.

## Where things live

| What | Where |
|------|-------|
| **All copy, pricing, nav, links** | `lib/site.ts` |
| Colour system, fonts, section canvases | `app/globals.css` (`@theme`) |
| Page composition (section order) | `app/page.tsx` |
| Sections | `components/*.tsx` |
| Photos + logo | `public/img/` |

Editing copy should almost never mean editing a component — `lib/site.ts` is the
single source of truth for text.

## Design system

The whole palette is derived from the two logo colours, exposed as Tailwind
theme tokens in `app/globals.css`:

- `brand-50 … brand-950` — built around **`#0033e7`** (`brand-500`), the logo blue.
- `accent-100 … accent-600` — built around **`#ff3131`** (`accent-500`), the logo red.
  Used sparingly: the dot in section labels, the "Most popular" badge, the last
  bar in the chart, hover arrows.
- `ink` (`#05061a`) — the near-black pricing band.
- `panel` / `panel-soft` — the deep-blue feature, CTA and footer bands.
- `canvas` (`#eceef2`) — the page tint behind the rounded shell.

Type is **Plus Jakarta Sans** (loaded and self-hosted via `next/font`), matching
the geometric sans in the reference design. Headings use the `display` utility
for the tight tracking that design relies on.

## The WhatsApp CTA

Every call to action opens WhatsApp rather than a signup form. The target is
built once in `lib/site.ts` from:

```
NEXT_PUBLIC_WHATSAPP_NUMBER   # wa.me digits, no + or spaces
```

Deployed on **Vercel** at https://www.userhodium.xyz (root directory
`apps/landing`). It defaults to `2348036803974` (+234 803 680 3974, "Fonio
Labs") — the same number as `WHATSAPP_WA_NUMBER` on the API service. Set the
env var at build time to point elsewhere:

```bash
NEXT_PUBLIC_WHATSAPP_NUMBER=2348012345678 npm run build
```

## Before you publish

`lib/site.ts` marks two things `[PLACEHOLDER]` — they are business decisions,
not product facts:

- **Pricing** (`plans`, `enterprisePlan`) — the ₦0 / ₦9,500 tiers are illustrative.
- **Contact email** (`site.email`).

The numbers shown in the hero ledger card and the traction dashboard mock are
clearly-labelled illustrative UI, not claimed metrics. There are no invented
testimonials or review counts anywhere on the page — the reference design's
star-rating strip was replaced with three factual product claims.
