import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

/**
 * Two families, split by job: Outfit sets every heading — geometric, tightly
 * tracked, and the closest match to the reference design's display type —
 * while Inter carries body copy, where a neutral grotesque reads better at
 * paragraph sizes and small UI sizes than a geometric face does.
 *
 * `display: "swap"` on both: text that is briefly in a fallback beats text
 * that is invisible while a font downloads.
 */
const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  /**
   * Required for share cards. Open Graph demands ABSOLUTE urls, and without a
   * base Next emits the relative path — which every crawler then fails to
   * fetch, so the link previews with no image and nobody can see why.
   */
  metadataBase: new URL(site.origin),
  title: `${site.name} — ${site.tagline}`,
  description: site.description,
  icons: { icon: "/img/logo.svg" },
  alternates: { canonical: "/" },
  openGraph: {
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    type: "website",
    url: site.origin,
    siteName: site.name,
    locale: "en_NG",
    images: [
      {
        // Committed, not generated at build: the site is a static export, so
        // there is no runtime to render one per request.
        url: "/img/og-cover.png",
        width: 1200,
        height: 630,
        alt: `${site.name} — ${site.tagline}`,
      },
    ],
  },
  twitter: {
    // Without this the card renders as a small thumbnail beside the text
    // rather than the full-width image.
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: ["/img/og-cover.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0033e7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} ${inter.variable}`}>
      <body className="font-sans text-brand-950 antialiased">{children}</body>
    </html>
  );
}
