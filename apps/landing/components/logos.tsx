import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Marks for the "built on" tiles.
 *
 * Everything but WhatsApp is a real logo file from public/img/brands/. They are
 * all square source images, so `object-contain` fills the tile exactly — the
 * full-bleed ones (Quai, BlipPay) keep their brand background, and the
 * transparent ones (Monnify, USDT, NDPR) sit on white.
 */

function BrandImage({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-brand-100/70">
      <Image
        src={src}
        alt={alt}
        width={88}
        height={88}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

/** WhatsApp has no file in public/img/brands, so it's drawn inline. */
export function WhatsAppMark() {
  return (
    <span
      className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#25D366]"
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="#fff" className="h-6 w-6">
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.17c-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.38-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23z" />
      </svg>
    </span>
  );
}

export const marks: Record<string, ReactNode> = {
  whatsapp: <WhatsAppMark />,
  quai: <BrandImage src="/img/brands/quai.jpg" alt="Quai Network" />,
  blippay: <BrandImage src="/img/brands/blippay.png" alt="BlipPay" />,
  monnify: <BrandImage src="/img/brands/monnify.png" alt="Monnify" />,
  usdt: <BrandImage src="/img/brands/usdt.png" alt="Tether USDT" />,
  ndpr: <BrandImage src="/img/brands/ndpr.jpeg" alt="NDPR" />,
};
