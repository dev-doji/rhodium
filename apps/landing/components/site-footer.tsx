import Link from "next/link";
import { footerColumns, site } from "@/lib/site";
import { WhatsAppIcon, Wordmark } from "./ui";

export function SiteFooter() {
  return (
    <footer className="bg-ink px-5 py-14 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:gap-8">
          <div>
            <Wordmark dark />
            <p className="measure mt-4 max-w-xs text-sm leading-relaxed text-white/45">
              WhatsApp-native commerce for African merchants. Take the payment
              where the conversation already is — and keep the books in naira.
            </p>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-white">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/45 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <p className="text-xs text-white/35">
              © {new Date().getFullYear()} {site.name}. All rights reserved.
            </p>
            <a
              href={`mailto:${site.email}`}
              className="text-xs text-white/45 transition-colors hover:text-white"
            >
              {site.email}
            </a>
          </div>

          <a
            href={site.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/15"
          >
            <WhatsAppIcon className="h-3.5 w-3.5" />
            Open on WhatsApp
          </a>
        </div>
      </div>
    </footer>
  );
}
