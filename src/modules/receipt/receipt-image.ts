import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Receipt rendering — ONE SVG, two outputs.
 *
 * PNG and PDF are drawn from the same source rather than by two renderers, so
 * they cannot drift: a buyer forwarding the image and an accountant filing the
 * PDF are looking at the same document.
 *
 * The PDF embeds the raster rather than redrawing as vector text. That trades
 * selectable text for guaranteed visual parity, which is the right way round
 * for a receipt whose job is to be recognised and forwarded.
 */

export interface ReceiptData {
  merchantName: string;
  merchantLogoUrl?: string;
  orderRef: string;
  amountFormatted: string;
  items: { name: string; qty: number; unitPriceFormatted: string }[];
  buyerMasked?: string;
  method: string;
  paidAt?: Date | null;
}

const W = 480;
const INK = "#16130f";
const INK2 = "#5c554c";
const INK3 = "#8b8378";
const LINE = "#e6e2dc";
const GOOD = "#0f5132";
const GOOD_BG = "#eaf5ee";
// The bundled family, not a web font. resvg renders server-side with no
// browser and no network, so the only fonts that exist are the ones we ship.
const SANS = "DejaVu Sans";
const MONO = "DejaVu Sans Mono";

/**
 * Fonts are BUNDLED and system fonts are ignored.
 *
 * This machine has 626 fonts; Render's container has almost none. Left to
 * substitute, resvg rendered the amount in a slanted fallback face because the
 * naira sign (U+20A6) was missing from its first choice — and the amount is
 * the one glyph on a receipt that must be right. Shipping the font makes the
 * output identical everywhere.
 */
const FONT_DIR = resolve("assets/fonts");
const FONT_FILES = [
  "DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSansMono.ttf",
].map((f) => resolve(FONT_DIR, f)).filter((f) => existsSync(f));

const RESVG_FONT = {
  fontFiles: FONT_FILES,
  // Only fall back to system fonts if the bundle is somehow missing, so a
  // broken deploy degrades to "wrong font" rather than "blank page".
  loadSystemFonts: FONT_FILES.length === 0,
  defaultFontFamily: "DejaVu Sans",
};

/** XML-escape — a product called "Tom & Jerry" must not break the document. */
function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Initials for the fallback disc: "Circuit City" -> "CC". */
function initials(name: string): string {
  return (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join("");
}

/** Rhodium's mark as paths — no network fetch, no font dependency. */
function rhodiumMark(x: number, y: number, size: number): string {
  const s = size / 211;
  return `<g transform="translate(${x} ${y}) scale(${s}) translate(-82 -83)">
    <path fill="${INK}" d="M207.7 209.9v-41.4h-41.4v-41.4h-41.4v124.2h124.2v-41.4z"/>
    <path fill="${INK}" d="M84.8 85.7h41.3v41.3H84.8z"/>
    <path fill="${INK}" d="M248.9 248h41.3v41.3h-41.3z"/>
    <path fill="#ff3131" d="M248.9 85.7h41.3v41.3h-41.3z"/>
  </g>`;
}

function height(d: ReceiptData): number {
  return 268 + Math.min(d.items.length, 12) * 30 + 150;
}

export function receiptSvg(d: ReceiptData): string {
  const rows = d.items.slice(0, 12);
  const listTop = 268;
  const H = height(d);
  const when = d.paidAt
    ? new Date(d.paidAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })
    : "";

  // Vendor mark: their logo when there is one, else initials on a tinted disc.
  // The fallback is deliberate-looking, so a merchant without a logo does not
  // get a receipt with a hole in it.
  const vendorMark = d.merchantLogoUrl
    ? `<image href="${esc(d.merchantLogoUrl)}" x="36" y="88" width="44" height="44" preserveAspectRatio="xMidYMid slice" clip-path="url(#disc)"/>`
    : `<circle cx="58" cy="110" r="22" fill="${GOOD_BG}"/>
       <text x="58" y="117" text-anchor="middle" font-family="${SANS}" font-size="17" font-weight="600" fill="${GOOD}">${esc(initials(d.merchantName))}</text>`;

  const itemRows = rows.map((it, i) => {
    const y = listTop + i * 30;
    return `<text x="36" y="${y}" font-family="${SANS}" font-size="14" fill="${INK}">${esc(it.name)}${it.qty > 1 ? ` &#215;${it.qty}` : ""}</text>
      <text x="${W - 36}" y="${y}" text-anchor="end" font-family="${SANS}" font-size="14" font-weight="600" fill="${INK}">${esc(it.unitPriceFormatted)}</text>
      <line x1="36" y1="${y + 12}" x2="${W - 36}" y2="${y + 12}" stroke="${LINE}" stroke-width="1"/>`;
  }).join("");

  const metaTop = listTop + rows.length * 30 + 28;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><clipPath id="disc"><circle cx="58" cy="110" r="22"/></clipPath></defs>
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${GOOD}"/>
  ${rhodiumMark(46, 44, 22)}
  <text x="72" y="51" font-family="${SANS}" font-size="13" font-weight="600" letter-spacing="1.6" fill="${INK3}">RECEIPT</text>
  <text x="${W - 36}" y="51" text-anchor="end" font-family="${SANS}" font-size="12" fill="${INK3}">${esc(when)}</text>
  ${vendorMark}
  <text x="94" y="105" font-family="${SANS}" font-size="17" font-weight="600" fill="${INK}">${esc(d.merchantName)}</text>
  <text x="94" y="124" font-family="${SANS}" font-size="12.5" fill="${INK3}">Paid in full</text>
  <text x="36" y="184" font-family="${SANS}" font-size="38" font-weight="600" fill="${INK}">${esc(d.amountFormatted)}</text>
  <rect x="36" y="204" width="${W - 72}" height="1" fill="${LINE}"/>
  <text x="36" y="236" font-family="${SANS}" font-size="11.5" font-weight="600" letter-spacing="1.2" fill="${INK3}">ITEMS</text>
  ${itemRows}
  <text x="36" y="${metaTop}" font-family="${SANS}" font-size="12.5" fill="${INK2}">Order</text>
  <text x="${W - 36}" y="${metaTop}" text-anchor="end" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${INK}">${esc(d.orderRef)}</text>
  <text x="36" y="${metaTop + 22}" font-family="${SANS}" font-size="12.5" fill="${INK2}">Method</text>
  <text x="${W - 36}" y="${metaTop + 22}" text-anchor="end" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${INK}">${esc(d.method)}</text>
  ${d.buyerMasked ? `<text x="36" y="${metaTop + 44}" font-family="${SANS}" font-size="12.5" fill="${INK2}">Paid by</text>
  <text x="${W - 36}" y="${metaTop + 44}" text-anchor="end" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${INK}">${esc(d.buyerMasked)}</text>` : ""}
  <text x="${W / 2}" y="${H - 26}" text-anchor="middle" font-family="${SANS}" font-size="11" fill="${INK3}">Proof of payment &#183; powered by Rhodium</text>
</svg>`;
}

/** 2x, so it stays crisp when a chat app scales it up. */
export function receiptPng(d: ReceiptData): Buffer {
  return Buffer.from(
    new Resvg(receiptSvg(d), {
      fitTo: { mode: "width", value: W * 2 },
      font: RESVG_FONT,
    }).render().asPng(),
  );
}

export async function receiptPdf(d: ReceiptData): Promise<Buffer> {
  const png = receiptPng(d);
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([W, height(d)]); // SVG units, so it is 1:1 with the PNG
  page.drawImage(img, { x: 0, y: 0, width: W, height: height(d) });
  pdf.setTitle(`Receipt ${d.orderRef} - ${d.merchantName}`);
  pdf.setProducer("Rhodium");
  return Buffer.from(await pdf.save());
}
