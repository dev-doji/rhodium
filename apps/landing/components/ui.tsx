import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** The Rhodium mark, drawn from the logo SVG so it can inherit currentColor. */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    /* viewBox is cropped to the mark's actual bounds so it doesn't sit in a
       well of empty padding at small sizes. */
    <svg
      viewBox="82 83 211 211"
      className={className}
      role="img"
      aria-label="Rhodium logo"
    >
      <path
        fill="currentColor"
        d="M207.7 209.9v-41.4h-41.4v-41.4h-41.4v124.2h124.2v-41.4z"
      />
      <path fill="currentColor" d="M84.8 85.7h41.3v41.3H84.8z" />
      <path fill="currentColor" d="M248.9 248h41.3v41.3h-41.3z" />
      <path fill="#ff3131" d="M248.9 85.7h41.3v41.3h-41.3z" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <Link
      href="#top"
      className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 rounded-lg"
    >
      <Logo className={dark ? "h-7 w-7 text-white" : "h-7 w-7 text-brand-500"} />
      <span
        className={`text-lg font-bold tracking-tight ${
          dark ? "text-white" : "text-brand-950"
        }`}
      >
        Rhodium
      </span>
    </Link>
  );
}

export function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.17c-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.38-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23z" />
    </svg>
  );
}

type ButtonProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "light" | "ghost" | "accent";
  children: ReactNode;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 active:scale-[0.98]";

const variants = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-lg shadow-brand-500/25",
  light: "bg-white text-brand-950 hover:bg-brand-50 ring-1 ring-brand-100",
  ghost:
    "bg-transparent text-white ring-1 ring-white/25 hover:bg-white/10 hover:ring-white/40",
  accent: "bg-accent-500 text-white hover:bg-accent-600 shadow-lg shadow-accent-500/25",
} as const;

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <Link className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </Link>
  );
}

/**
 * Section eyebrow: a letterspaced label between short accent rules.
 * Centred sections get a rule on both sides, left-aligned ones only on the left.
 */
export function SectionLabel({
  children,
  tone = "light",
  align = "left",
}: {
  children: ReactNode;
  tone?: "light" | "dark";
  align?: "left" | "center";
}) {
  const rule = tone === "dark" ? "bg-accent-400/70" : "bg-accent-500/70";
  const text = tone === "dark" ? "text-brand-200" : "text-brand-600";

  return (
    <div
      className={`flex items-center gap-3 ${
        align === "center" ? "justify-center" : ""
      }`}
    >
      <span className={`h-px w-7 ${rule}`} aria-hidden />
      <span
        className={`text-[11px] font-bold uppercase tracking-[0.2em] ${text}`}
      >
        {children}
      </span>
      {align === "center" && <span className={`h-px w-7 ${rule}`} aria-hidden />}
    </div>
  );
}

/**
 * A photograph slot.
 *
 * The design is photo-led, but the photography arrives on its own schedule, so
 * a slot with no `src` renders a branded panel with the Rhodium mark rather
 * than a broken image or a grey void. Dropping a file into `public/img` and
 * passing its path is the only change needed later — no layout work, because
 * the slot already reserves its aspect ratio and so cannot shift the page when
 * the real image lands.
 */
export function PhotoSlot({
  src,
  alt,
  className = "",
  sizes = "(max-width: 1024px) 100vw, 50vw",
  priority = false,
  rounded = "rounded-4xl",
}: {
  src?: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  rounded?: string;
}) {
  return (
    <div className={`relative overflow-hidden ${rounded} ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover"
          priority={priority}
        />
      ) : (
        // Decorative stand-in: it carries no information, so it is hidden from
        // screen readers rather than announced as a meaningless image.
        <div
          aria-hidden
          className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-tint))]"
        >
          <Logo className="h-12 w-12 text-brand-500/25" />
        </div>
      )}
    </div>
  );
}

/** A floating figure card, laid over the hero photograph. */
export function FloatCard({
  title,
  value,
  note,
  className = "",
}: {
  title: string;
  value: string;
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white/95 p-4 shadow-xl shadow-brand-950/15 ring-1 ring-brand-950/5 backdrop-blur-sm ${className}`}
    >
      <p className="text-[11px] font-medium text-brand-950/65">{title}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight text-brand-950 tabular-nums">
        {value}
      </p>
      {note && <p className="mt-0.5 text-[11px] text-brand-500">{note}</p>}
    </div>
  );
}
