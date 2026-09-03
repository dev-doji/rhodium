import { ArrowUpRight } from "lucide-react";
import { heroStats, site } from "@/lib/site";
import { Button, FloatCard, PhotoSlot, WhatsAppIcon } from "./ui";

/**
 * Centred headline over one large photograph, with figure cards floating at
 * its corners.
 *
 * The cards sit *inside* the image frame on desktop and drop below it on
 * phones: overlaying them on a 375px-wide photo would either cover the
 * subject's face or shrink the type past readability, and a stat nobody can
 * read is worse than one that has moved.
 */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 h-[380px] bg-[radial-gradient(55%_100%_at_50%_0%,rgba(0,51,231,0.12),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="display text-[2.15rem] font-extrabold sm:text-5xl lg:text-[4rem]">
            Sell on WhatsApp.
            <br />
            Get paid without the screenshot.
          </h1>

          <p className="measure mx-auto mt-5 max-w-xl text-base text-brand-950/60 sm:text-lg">
            {site.description}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              href={site.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <WhatsAppIcon />
              Open on WhatsApp
            </Button>
            <Button href="#how" variant="light" className="w-full sm:w-auto">
              See how it works
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative mx-auto mt-12 max-w-5xl lg:mt-16">
          <PhotoSlot
            src="/img/woman_two.jpg"
            alt="A Nigerian shop owner taking a customer's order on her phone"
            className="aspect-[16/11] w-full sm:aspect-[16/9]"
            sizes="(max-width: 1024px) 100vw, 1024px"
            priority
            rounded="rounded-4xl"
          />

          <FloatCard
            title="Today's sales"
            value={heroStats.ledger.amount}
            note={heroStats.ledger.delta}
            className="mt-3 sm:absolute sm:-bottom-6 sm:left-6 sm:mt-0 sm:w-44 lg:left-8"
          />
          <FloatCard
            title="Transfer confirmed in"
            value={heroStats.confirm.value}
            note="No screenshot needed"
            className="mt-3 sm:absolute sm:-top-6 sm:right-6 sm:mt-0 sm:w-44 lg:right-8"
          />
        </div>
      </div>
    </section>
  );
}
