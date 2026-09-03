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
  title: `${site.name} — ${site.tagline}`,
  description: site.description,
  icons: { icon: "/img/logo.svg" },
  openGraph: {
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    type: "website",
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
