import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { closingCta, site } from "@/lib/site";
import { Button, WhatsAppIcon } from "./ui";

/**
 * Full-bleed photograph with the closing ask laid over it.
 *
 * The scrim is deliberately heavy. Text over a photograph is the easiest
 * place on a page to fail contrast, and this is the one block that has to
 * stay readable — it is where the visitor either acts or leaves.
 */
export function Cta() {
  return (
    <section className="relative isolate overflow-hidden bg-panel">
      <Image
        src="/img/woman_two.jpg"
        alt=""
        aria-hidden
        fill
        sizes="100vw"
        className="object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-brand-950/95 via-brand-950/85 to-brand-950/60"
      />

      <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-xl">
          <h2 className="display text-[1.95rem] font-extrabold text-white sm:text-4xl lg:text-[2.9rem]">
            {closingCta.title}
          </h2>
          <p className="measure mt-4 text-brand-100/75">{closingCta.body}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              href={site.registerUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              className="w-full sm:w-auto"
            >
              <WhatsAppIcon />
              {closingCta.cta}
            </Button>
            <Button href="#pricing" variant="ghost" className="w-full sm:w-auto">
              See pricing
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
