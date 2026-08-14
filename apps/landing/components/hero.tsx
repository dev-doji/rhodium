import Image from "next/image";
import { ArrowUpRight, Check, Sparkles } from "lucide-react";
import { heroStats, site, trustPoints } from "@/lib/site";
import { Button, WhatsAppIcon } from "./ui";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-white">
      {/* Soft brand wash behind the headline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(0,51,231,0.13),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-7xl px-5 pb-14 pt-14 sm:px-8 sm:pt-20 lg:pb-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="display text-4xl font-bold sm:text-5xl lg:text-[3.75rem]">
            Sell on WhatsApp.
            <br />
            Get paid without the screenshot.
          </h1>

          <p className="measure mx-auto mt-5 max-w-xl text-base text-brand-950/60 sm:text-lg">
            {site.description}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              href={site.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <WhatsAppIcon />
              Open on WhatsApp
            </Button>
            <Button href="#how" variant="light" className="w-full sm:w-auto">
              See how it works
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>

          <ul className="mt-8 flex flex-col items-center justify-center gap-x-6 gap-y-2 text-sm text-brand-950/55 sm:flex-row sm:flex-wrap">
            {trustPoints.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-brand-500" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Bento row */}
        <div className="mt-12 grid grid-cols-2 items-center gap-3 sm:gap-4 lg:mt-16 lg:grid-cols-5">
          <PhotoCard
            src="/img/woman_two.jpg"
            alt="A cosmetics seller in her shop, taking an order on her phone"
            className="order-4 col-span-2 h-52 sm:col-span-1 lg:order-1 lg:h-60"
            priority
          />

          <StatCard
            tone="dark"
            value={heroStats.confirm.value}
            label={heroStats.confirm.label}
            className="order-2 h-40 lg:order-2 lg:h-48"
          />

          <LedgerCard className="order-1 col-span-2 lg:order-3 lg:col-span-1" />

          <StatCard
            tone="tint"
            value={heroStats.rails.value}
            label={heroStats.rails.label}
            className="order-3 h-40 lg:order-4 lg:h-48"
          />

          <PhotoCard
            src="/img/man_one.jpg"
            alt="A sneaker seller listing stock from his phone"
            className="order-5 col-span-2 h-52 sm:col-span-1 lg:h-60"
            priority
            overlay={{
              value: heroStats.custody.value,
              label: heroStats.custody.label,
            }}
          />
        </div>
      </div>
    </section>
  );
}

function PhotoCard({
  src,
  alt,
  className = "",
  overlay,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  overlay?: { value: string; label: string };
  priority?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-3xl ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 1024px) 50vw, 20vw"
        className="object-cover"
        priority={priority}
      />
      {overlay && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-brand-950/90 via-brand-950/40 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="text-2xl font-bold text-white">{overlay.value}</p>
            <p className="mt-1 text-xs leading-snug text-brand-100/90">
              {overlay.label}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  value,
  label,
  tone,
  className = "",
}: {
  value: string;
  label: string;
  tone: "dark" | "tint";
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div
      className={`flex flex-col justify-between rounded-3xl p-5 ${
        dark ? "bg-panel text-white" : "bg-brand-100 text-brand-950"
      } ${className}`}
    >
      <Sparkles
        className={`h-5 w-5 ${dark ? "text-brand-300" : "text-brand-500"}`}
      />
      <div>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p
          className={`mt-1.5 text-xs leading-snug ${
            dark ? "text-brand-100/70" : "text-brand-950/60"
          }`}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

/** An illustrative slice of the merchant ledger — the product's payoff, on screen. */
function LedgerCard({ className = "" }: { className?: string }) {
  const rows = [
    { label: "Ada · 2 jars shea butter", amount: "₦12,500", rail: "Transfer" },
    { label: "Chidi · sneakers (size 43)", amount: "₦46,000", rail: "Crypto" },
    { label: "Ngozi · beans, 5kg", amount: "₦3,250", rail: "Transfer" },
  ];

  return (
    <div
      className={`flex flex-col rounded-3xl bg-white p-5 shadow-xl shadow-brand-950/10 ring-1 ring-brand-100 lg:h-72 ${className}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-brand-950/50">
            {heroStats.ledger.title}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {heroStats.ledger.amount}
          </p>
        </div>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-600">
          {heroStats.ledger.delta}
        </span>
      </div>

      <ul className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10">
              <Check className="h-3.5 w-3.5 text-brand-500" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-brand-950/70">
              {row.label}
            </span>
            <span className="text-[11px] font-semibold">{row.amount}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-brand-100 pt-3 text-[11px] leading-snug text-brand-950/45 lg:mt-auto">
        {heroStats.ledger.note}
      </p>
    </div>
  );
}
