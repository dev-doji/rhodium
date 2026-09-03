# Bundled fonts

DejaVu Sans, shipped deliberately rather than relying on system fonts.

Receipt images are rendered server-side by resvg. This machine has 626 fonts;
Render's container has almost none — so a receipt that looks right locally
would render with substituted faces, or tofu boxes, in production. The naira
sign in particular (₦, U+20A6) is missing from many default sets, and that is
the single most important glyph on the page.

DejaVu Sans contains U+20A6 (verified) and is licensed for redistribution
under the Bitstream Vera / DejaVu licence.
