import type { ReactNode } from "react";

/**
 * Typographic marks for the "Built on" tiles.
 *
 * Deliberately NOT other companies' logos. The previous version rendered
 * Paystack-style brand images from public/img/brands, which carries two
 * problems: using a trademark without permission is its own exposure, and a
 * wall of real logos reads as endorsement or partnership when these are simply
 * technologies the product runs on.
 *
 * Initials in a neutral tile say the same true thing — "this is what we use" —
 * and claim nothing about a relationship that does not exist.
 */
function InitialMark({ label, initials }: { label: string; initials: string }) {
  return (
    <span
      className="flex h-11 w-11 items-center justify-center rounded-none border border-brand-950/12 bg-white text-[13px] font-bold tracking-tight text-brand-700"
      // The visible initials are decorative shorthand; the tile's real name is
      // announced once, by the label beside it, so a screen reader does not
      // read "PS" and then "Paystack".
      aria-hidden
      title={label}
    >
      {initials}
    </span>
  );
}

export const marks: Record<string, ReactNode> = {
  whatsapp: <InitialMark label="WhatsApp" initials="WA" />,
  paystack: <InitialMark label="Paystack" initials="PS" />,
  arbitrum: <InitialMark label="Arbitrum" initials="ARB" />,
  usdc: <InitialMark label="USDC" initials="$" />,
  onswitch: <InitialMark label="OnSwitch" initials="OS" />,
};
