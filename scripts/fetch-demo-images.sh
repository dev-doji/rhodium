#!/usr/bin/env bash
# Fetches stock photography for the demo catalogue.
#
# Run once; the images are committed so the demo works offline and on Render
# without a runtime dependency on any image host. Re-run only to refresh them.
#
# Source is loremflickr, which serves Creative Commons photos from Flickr by
# keyword. Fine for a seeded demo store; replace with the vendor's own
# photography before any of this is shown as real inventory.
set -uo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/public/img/products"
mkdir -p "$OUT"

# slug|keyword — the slug is what the seed script references.
ITEMS='
hdmi-cable|hdmi,cable
wireless-mouse|computer,mouse
phone-tripod|tripod,phone
laptop-sleeve|laptop,sleeve
gan-charger|charger,usb
wireless-charging-pad|wireless,charger
laptop-stand|laptop,stand
usb-c-hub|usb,hub
webcam|webcam
power-bank|powerbank,battery
bluetooth-speaker|bluetooth,speaker
mechanical-keyboard|mechanical,keyboard
smart-watch|smartwatch
earbuds|earbuds,headphones
external-ssd|ssd,harddrive
hoop-earrings|gold,earrings
pearl-necklace|pearl,necklace
bangle-set|bangle,bracelet
silver-anklet|silver,anklet
waist-chain|beads,jewellery
'

ok=0; fail=0
while IFS='|' read -r slug kw; do
  [ -z "$slug" ] && continue
  dest="$OUT/$slug.jpg"
  if curl -sL --max-time 30 -o "$dest" "https://loremflickr.com/600/600/$kw" \
     && [ -s "$dest" ] \
     && [ "$(file -b --mime-type "$dest")" = "image/jpeg" ]; then
    printf '  ok    %-24s %6s bytes\n' "$slug" "$(stat -c%s "$dest")"
    ok=$((ok+1))
  else
    # A missing image is not fatal: the storefront renders a branded
    # placeholder for any product without one.
    printf '  FAIL  %-24s (leaving it out)\n' "$slug"
    rm -f "$dest"
    fail=$((fail+1))
  fi
done <<< "$ITEMS"

echo
echo "  $ok downloaded, $fail failed -> $OUT"
