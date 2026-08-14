"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { nav, site } from "@/lib/site";
import { Button, WhatsAppIcon, Wordmark } from "./ui";

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  // A menu left open while the viewport grows would strand the page behind it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => mq.matches && setOpen(false);
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-brand-100/70 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <Wordmark />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {nav.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-full px-4 py-2 text-sm font-medium text-brand-950/70 transition-colors hover:bg-brand-50 hover:text-brand-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Wrapped rather than given `hidden sm:inline-flex` — that would
              fight the `inline-flex` already inside Button's base classes. */}
          <div className="hidden sm:block">
            <Button
              href={site.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 whitespace-nowrap"
            >
              <WhatsAppIcon />
              Open on WhatsApp
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-brand-100 text-brand-950 transition-colors hover:bg-brand-50 lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="border-t border-brand-100 bg-white px-5 pb-6 pt-3 sm:px-8 lg:hidden"
        >
          <nav className="flex flex-col" aria-label="Mobile">
            {nav.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-base font-medium text-brand-950 transition-colors hover:bg-brand-50"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Button
            href={site.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 w-full"
          >
            <WhatsAppIcon />
            Open on WhatsApp
          </Button>
        </div>
      )}
    </header>
  );
}
