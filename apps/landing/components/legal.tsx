import Link from "next/link";
import type { ReactNode } from "react";
import { site } from "@/lib/site";

/**
 * Shared chrome for the legal pages.
 *
 * These are the two URLs Meta's reviewers actually open, so they live on the
 * marketing domain rather than the API: a policy served from an app subdomain
 * that sleeps on a free tier reads as abandoned, and a reviewer who gets a
 * timeout does not retry.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <Link
        href="/"
        className="text-sm font-medium text-brand-500 hover:text-brand-600"
      >
        ← {site.name}
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-brand-950">
        {title}
      </h1>
      <p className="mt-2 text-sm text-brand-950/50">Last updated: {updated}</p>
      <div className="legal mt-10 space-y-6 text-[15px] leading-relaxed text-brand-950/80">
        {children}
      </div>
      <hr className="my-12 border-brand-950/10" />
      <p className="text-sm text-brand-950/50">
        <Link href="/privacy" className="text-brand-500 hover:text-brand-600">
          Privacy Policy
        </Link>
        {" · "}
        <Link href="/terms" className="text-brand-500 hover:text-brand-600">
          Terms of Service
        </Link>
        {" · "}
        <a
          href={`mailto:${site.legalEmail}`}
          className="text-brand-500 hover:text-brand-600"
        >
          {site.legalEmail}
        </a>
      </p>
    </main>
  );
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 pt-4 text-lg font-semibold text-brand-950"
    >
      {children}
    </h2>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="ml-5 list-disc space-y-2">{children}</ul>;
}
