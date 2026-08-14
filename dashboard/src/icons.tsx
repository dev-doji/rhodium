/**
 * Inline SVG icons — no icon dependency for ~14 glyphs.
 *
 * All stroke icons inherit `currentColor` and share the 24px Feather grid, so
 * they sit consistently next to text at any size.
 */
type P = { size?: number; className?: string };

const stroke = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

/** The Rhodium mark, traced from the logo. The coral square is fixed brand
 *  colour; everything else inherits currentColor so it works on any surface. */
export const RhodiumLogo = ({ size = 22, className }: P) => (
  <svg viewBox="82 83 211 211" width={size} height={size} className={className} role="img" aria-label="Rhodium">
    <path fill="currentColor" d="M207.7 209.9v-41.4h-41.4v-41.4h-41.4v124.2h124.2v-41.4z" />
    <path fill="currentColor" d="M84.8 85.7h41.3v41.3H84.8z" />
    <path fill="currentColor" d="M248.9 248h41.3v41.3h-41.3z" />
    <path fill="#ff3131" d="M248.9 85.7h41.3v41.3h-41.3z" />
  </svg>
);

export const Wallet = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" /><circle cx="16.5" cy="13" r="1.2" fill="currentColor" stroke="none" /></svg>
);
export const TrendUp = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><path d="M3 17l6-6 4 4 7-7" /><path d="M17 8h4v4" /></svg>
);
export const CheckCircle = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>
);
export const Box = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
);
export const Search = ({ size = 17 }: P) => (
  <svg {...stroke(size)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>
);
export const Bell = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><path d="M18 8a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M10.5 19a1.8 1.8 0 0 0 3 0" /></svg>
);
export const Gear = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z" /></svg>
);
export const Filter = ({ size = 16 }: P) => (
  <svg {...stroke(size)}><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></svg>
);
export const Calendar = ({ size = 16 }: P) => (
  <svg {...stroke(size)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const Rows = ({ size = 15 }: P) => (
  <svg {...stroke(size)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const Grid = ({ size = 15 }: P) => (
  <svg {...stroke(size)}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
);
export const X = ({ size = 19 }: P) => (
  <svg {...stroke(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Download = ({ size = 16 }: P) => (
  <svg {...stroke(size)}><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M4 19h16" /></svg>
);
export const Phone = ({ size = 15 }: P) => (
  <svg {...stroke(size)}><path d="M21 16.9v2.4a1.6 1.6 0 0 1-1.8 1.6 16 16 0 0 1-7-2.5 15.7 15.7 0 0 1-4.8-4.8 16 16 0 0 1-2.5-7A1.6 1.6 0 0 1 6.5 5H9a1.6 1.6 0 0 1 1.6 1.4c.1.8.3 1.5.5 2.2a1.6 1.6 0 0 1-.4 1.7l-1 1a13 13 0 0 0 4.8 4.8l1-1a1.6 1.6 0 0 1 1.7-.4c.7.3 1.4.4 2.2.5A1.6 1.6 0 0 1 21 16.9z" /></svg>
);
export const ExternalLink = ({ size = 15 }: P) => (
  <svg {...stroke(size)}><path d="M14 4h6v6" /><path d="M20 4l-8 8" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>
);
export const Receipt = ({ size = 18 }: P) => (
  <svg {...stroke(size)}><path d="M5 3v18l2.5-1.6L10 21l2-1.6L14 21l2.5-1.6L19 21V3z" /><path d="M9 8h6M9 12h6" /></svg>
);
export const Plus = ({ size = 16 }: P) => (
  <svg {...stroke(size)}><path d="M12 5v14M5 12h14" /></svg>
);
