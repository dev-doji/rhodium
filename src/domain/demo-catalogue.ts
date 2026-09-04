/**
 * The demo catalogue, in one place.
 *
 * Shared by the seed script (which creates these products) and the image
 * backfill endpoint (which repairs products created before the catalogue
 * carried photographs). Keeping one copy matters because the two are matched
 * on product NAME: a name edited here and not there silently stops matching,
 * and the backfill would quietly do nothing.
 *
 * Photographs live in `public/img/products/` and are committed, so nothing
 * here depends on an image host being reachable at runtime.
 */

/** [display name, price in naira, image slug under public/img/products]. */
export type CatalogueItem = readonly [string, number, string];

export const CIRCUIT_CITY_ITEMS: readonly CatalogueItem[] = [
  // Deliberately spans ₦6,500 → ₦95,000. The cheap end matters: a buyer paying
  // in testnet QUAI needs an item they can actually afford from a faucet.
  ["HDMI Cable 2m", 6_500, "hdmi-cable"],
  ["Wireless Mouse", 12_000, "wireless-mouse"],
  ["Phone Tripod + Ring Light", 15_000, "phone-tripod"],
  ['Laptop Sleeve 15"', 16_000, "laptop-sleeve"],
  ["65W GaN Fast Charger", 18_000, "gan-charger"],
  ["Wireless Charging Pad", 20_000, "wireless-charging-pad"],
  ["Laptop Stand (Aluminium)", 22_000, "laptop-stand"],
  ["USB-C Hub 6-in-1", 28_000, "usb-c-hub"],
  ["Webcam 1080p", 32_000, "webcam"],
  ["Power Bank 20,000mAh", 35_000, "power-bank"],
  ["Bluetooth Speaker", 40_000, "bluetooth-speaker"],
  ["Mechanical Keyboard", 45_000, "mechanical-keyboard"],
  ["Smart Watch", 55_000, "smart-watch"],
  ["Noise-Cancelling Earbuds", 65_000, "earbuds"],
  ["External SSD 1TB", 95_000, "external-ssd"],
] as const;

export const DIADEM_ITEMS: readonly CatalogueItem[] = [
  ["Gold-Plated Hoop Earrings", 8_500, "hoop-earrings"],
  ["Pearl Drop Necklace", 15_000, "pearl-necklace"],
  ["Stainless Steel Bangle Set", 12_000, "bangle-set"],
  ["Silver Anklet", 6_500, "silver-anklet"],
  ["Beaded Waist Chain", 4_000, "waist-chain"],
] as const;

/** Public path for a catalogue image slug. */
export const demoImageUrl = (slug: string): string => `/img/products/${slug}.jpg`;

/**
 * Product name → image path, for every demo item across both stores.
 *
 * Names are compared case-insensitively and with surrounding whitespace
 * trimmed, because these products were typed into a seed script and a
 * stray space should not cost a photograph.
 */
export const demoImageByName: ReadonlyMap<string, string> = new Map(
  [...CIRCUIT_CITY_ITEMS, ...DIADEM_ITEMS].map(([name, , slug]) => [
    name.trim().toLowerCase(),
    demoImageUrl(slug),
  ]),
);
