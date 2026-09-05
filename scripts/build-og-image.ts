/**
 * Renders the social share card for the landing page.
 *
 * Run once and commit the PNG; the landing site is a static export, so there
 * is no runtime to generate this per request, and a share card that depends on
 * a build step nobody remembers is a share card that eventually 404s.
 *
 *   npx tsx scripts/build-og-image.ts
 *
 * 1200x630 is the size Facebook, WhatsApp, LinkedIn and X all crop from. Text
 * is kept well inside the edges because each of them crops differently, and a
 * headline clipped in half looks worse than no image at all.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const OUT = resolve("apps/landing/public/img/og-cover.png");
const FONT_DIR = resolve("assets/fonts");

// The Rhodium mark, from components/ui.tsx. Its viewBox is 82..293, so it is
// translated and scaled rather than redrawn.
const MARK = `
  <g transform="translate(80, 74) scale(0.42) translate(-82, -83)">
    <path fill="#ffffff" d="M207.7 209.9v-41.4h-41.4v-41.4h-41.4v124.2h124.2v-41.4z"/>
    <path fill="#ffffff" d="M84.8 85.7h41.3v41.3H84.8z"/>
    <path fill="#ffffff" d="M248.9 248h41.3v41.3h-41.3z"/>
    <path fill="#ff3131" d="M248.9 85.7h41.3v41.3h-41.3z"/>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#04123f"/>
      <stop offset="60%" stop-color="#001a76"/>
      <stop offset="100%" stop-color="#0033e7"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- A single accent bar, echoing the flat square-bordered surfaces the
       product uses everywhere else. -->
  <rect x="0" y="0" width="1200" height="10" fill="#ff3131"/>

  ${MARK}
  <text x="196" y="131" font-family="DejaVu Sans" font-size="38" font-weight="bold" fill="#ffffff">Rhodium</text>

  <text x="80" y="250" font-family="DejaVu Sans" font-size="76" font-weight="bold" fill="#ffffff">Sell on WhatsApp.</text>
  <text x="80" y="340" font-family="DejaVu Sans" font-size="76" font-weight="bold" fill="#ffffff">Get paid without</text>
  <text x="80" y="430" font-family="DejaVu Sans" font-size="76" font-weight="bold" fill="#ffffff">the screenshot.</text>

  <text x="80" y="512" font-family="DejaVu Sans" font-size="30" fill="#b9c4e8">Bank transfer or stablecoin, auto-confirmed in seconds,</text>
  <text x="80" y="552" font-family="DejaVu Sans" font-size="30" fill="#b9c4e8">every sale booked in naira.</text>

  <text x="1120" y="552" text-anchor="end" font-family="DejaVu Sans" font-size="26" fill="#8aa3f7">userhodium.xyz</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: {
    fontDirs: [FONT_DIR],
    defaultFontFamily: "DejaVu Sans",
    loadSystemFonts: false, // deterministic: the same bytes on any machine
  },
})
  .render()
  .asPng();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} — 1200x630, ${(png.length / 1024).toFixed(0)}KB`);

// Guard the thing that actually breaks share cards: the crawlers that fetch
// them will not follow a redirect chain or wait on a slow origin, and several
// cap the file size.
if (png.length > 1_000_000) {
  console.warn("WARNING: over 1MB — some crawlers refuse images that large");
}
