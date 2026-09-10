import { ArrowUpRight } from "lucide-react";
import { heroStats, site } from "@/lib/site";
import { Button, FloatCard, PhotoSlot, SaleAlertCard, WhatsAppIcon } from "./ui";

/**
 * Centred headline over one photograph, with three cards floating beside it.
 *
 * The photograph is SQUARE, and that dictates the layout. `object-cover` in a
 * 16/9 frame would keep only the middle 56% of a square source — which here is
 * the crop that takes off the subject's head and her feet — so the frame stays
 * near-square and the picture is held to a narrow column. The cards then live
 * in the gutters either side of it rather than on top of it.
 *
 * Those gutters only exist from `lg` up. Below that the cards stack under the
 * photo: overlaying them on a 375px-wide image would cover the subject's face
 * or shrink the type past reading, and a figure nobody can read is worse than
 * one that has moved.
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
              href={site.registerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <WhatsAppIcon />
              Create your shop — free
            </Button>
            <Button href="#how" variant="light" className="w-full sm:w-auto">
              See how it works
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative mx-auto mt-12 max-w-5xl lg:mt-16">
          <div className="mx-auto w-full max-w-sm sm:max-w-md lg:max-w-xl">
            <PhotoSlot
              src="/img/hero_cover.jpg"
              alt="A Nigerian shop owner sitting with her phone, smiling at a payment alert"
              className="aspect-[4/5] w-full sm:aspect-[9/10]"
              sizes="(max-width: 1024px) 100vw, 576px"
              priority
              rounded="rounded-none"
              // Anchored right: the frame is narrower than the square file, and
              // the tenth of the picture it drops is the left edge, where the
              // studio light and its stand foot are. The subject and the plant
              // both sit right of centre, so nothing else is lost.
              position="object-right"
            />
          </div>

          {/*
            One grid below the photo on small screens; three absolutely placed
            cards in the gutters from `lg`. The wrapper drops to `display:block`
            there so the grid's own track sizing stops applying to children that
            have left the flow.
          */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:mt-0 lg:block">
            <FloatCard
              title="Transfer confirmed in"
              value={heroStats.confirm.value}
              note="No screenshot needed"
              className="lg:absolute lg:left-0 lg:top-10 lg:w-52"
            />
            <FloatCard
              title="Today's sales · example"
              value={heroStats.ledger.amount}
              note={heroStats.ledger.delta}
              className="lg:absolute lg:bottom-10 lg:left-0 lg:w-52"
            />
            <SaleAlertCard
              shop={heroStats.sale.shop}
              amount={heroStats.sale.amount}
              item={heroStats.sale.item}
              when={heroStats.sale.when}
              className="sm:col-span-1 lg:absolute lg:right-0 lg:top-1/3 lg:w-56"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
