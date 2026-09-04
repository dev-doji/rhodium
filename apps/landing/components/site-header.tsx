"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { nav, site } from "@/lib/site";
import { Button, Wordmark } from "./ui";

/**
 * Thin announcement strip plus the main navigation.
 *
 * The strip is a real link rather than decoration — a bar that looks
 * clickable and isn't is a small betrayal that costs trust on the first
 * second of the page.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50">
      <Link
        href="#how"
        className="block bg-panel px-5 py-2 text-center text-[12.5px] font-medium text-brand-100 transition-colors hover:bg-brand-900 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-300"
      >
        Take your first confirmed WhatsApp payment today —{" "}
        <span className="underline underline-offset-2">see how it works</span>
      </Link>

      <div className="border-b border-brand-950/8 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 sm:px-8">
          <Wordmark />

          <nav
            aria-label="Primary"
            className="ml-auto hidden items-center gap-1 lg:flex"
          >
            {nav.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-none px-3.5 py-2 text-sm font-medium text-brand-950/70 transition-colors hover:bg-brand-50 hover:text-brand-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-2">
            {/* Returning vendors need a way back in that is not "message the
                bot again". Text link, not a second button: only one control
                up here should read as the primary action. */}
            <a
              href={site.dashboardUrl}
              className="hidden px-3.5 py-2 text-sm font-medium text-brand-950/70 transition-colors hover:text-brand-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 sm:inline-flex"
            >
              Sign in
            </a>
            <Button
              href={site.registerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden px-5 py-2.5 sm:inline-flex"
            >
              Create your shop
            </Button>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              /* 44px minimum, so the control is reliably tappable rather than
                 merely visible. */
              className="grid h-11 w-11 place-items-center rounded-none text-brand-950 border border-brand-950/10 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 lg:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div
            id="mobile-nav"
            className="border-t border-brand-950/8 bg-white px-5 pb-5 pt-2 sm:px-8 lg:hidden"
          >
            <nav aria-label="Mobile" className="flex flex-col">
              {nav.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-none px-3 py-3 text-[15px] font-medium text-brand-950/80 transition-colors hover:bg-brand-50"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Button
              href={site.registerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 w-full"
            >
              Create your shop
            </Button>
            <a
              href={site.dashboardUrl}
              className="mt-2 block rounded-none px-3 py-3 text-center text-[15px] font-medium text-brand-950/70 transition-colors hover:bg-brand-50"
            >
              Sign in
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
