import Link from "next/link";
import { footerColumns, site } from "@/lib/site";
import { Wordmark } from "./ui";

/**
 * Dark closing footer: link columns, then a legal rule.
 *
 * There is no newsletter signup here, unlike the reference design. A field
 * that collects an address nothing is built to receive or store would be a
 * promise the product cannot keep, and under NDPR it would be collecting
 * personal data with no controller, purpose or retention behind it.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-ink px-5 pb-10 pt-16 text-white sm:px-8 sm:pt-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div>
            <Wordmark dark />
            <p className="measure mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              {site.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  {column.title}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-white/65 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-7 text-xs text-white/60 sm:flex-row sm:items-center">
          <p>
            © {year} {site.company}. Rhodium is a product of {site.company}.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <Link href="/privacy" className="transition-colors hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-white">
              Terms of Service
            </Link>
            <a
              href={`mailto:${site.email}`}
              className="transition-colors hover:text-white"
            >
              {site.email}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
