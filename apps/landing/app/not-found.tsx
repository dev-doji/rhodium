import Link from "next/link";
import type { Metadata } from "next";

/**
 * The landing site's 404.
 *
 * The static export previously fell back to Next's stock "404 | This page could
 * not be found" — a black-on-white system-font line with no way onward and no
 * sign of whose site it is. Someone arriving from a stale ad or a mistyped link
 * saw a page that looked broken rather than a page that was missing.
 *
 * Deliberately the same shape as the error page the API serves (see
 * src/http/error-page.ts): a buyer who mistypes a shop link and a visitor who
 * mistypes the marketing URL land somewhere that looks like one company.
 */
export const metadata: Metadata = {
  title: "Not found · Rhodium",
  // A 404 in a search index is a dead end other people can find.
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fc] px-6 py-16">
      <div className="w-full max-w-[560px] border border-brand-950/12 bg-white px-9 py-10">
        <div className="mb-7 font-display text-[19px] font-extrabold tracking-tight text-brand-950">
          Rhodium<span className="text-brand-500">.</span>
        </div>

        {/* Decorative: the headline below carries the meaning, so a screen
            reader is not made to announce a bare number first. */}
        <div
          aria-hidden
          className="mb-3.5 font-display text-[64px] font-extrabold leading-none tracking-tighter text-brand-500"
        >
          404
        </div>

        <h1 className="mb-3 font-display text-[27px] font-bold leading-tight tracking-tight text-brand-950">
          There&rsquo;s nothing at this address
        </h1>
        <p className="mb-2 text-[15.5px] leading-relaxed text-brand-950/70">
          The link may be wrong, or whatever used to be here has been removed. It is worth
          checking the address for a missing character.
        </p>

        <div className="mt-7 flex flex-wrap gap-2.5">
          <Link
            href="/"
            className="rounded-none border border-brand-500 bg-brand-500 px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:border-brand-600 hover:bg-brand-600 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            Go to Rhodium
          </Link>
        </div>
      </div>
    </main>
  );
}
