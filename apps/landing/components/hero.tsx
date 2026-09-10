import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { heroStats, site } from "@/lib/site";
import { Button, FloatCard, SaleAlertCard, WhatsAppIcon } from "./ui";

/**
 * The photograph IS the hero: full-bleed, with the copy set over its empty half.
 *
 * The picture is shot for this — subject and plant on the right, nothing but
 * sweep on the left — so the layout has two jobs: never crop her, and never run
 * past the window, because a hero you have to scroll to finish is not a hero.
 *
 * Height comes first. `h-[calc(100vh-6.5rem)]` is the viewport minus the header,
 * capped at 48rem so a tall window does not stretch the section past what the
 * copy needs. That makes the FRAME wider than the file, and object-cover has to
 * take the difference out of something.
 *
 * So the file is built to have something worthless to take. `hero_wide.jpg` is
 * the photograph with 940px of sweep grown sideways off its first column,
 * making it 2.78:1 — wider than any frame this section can reach. Cover
 * therefore scales it to HEIGHT, and `object-right` spends the leftover on the
 * synthetic backdrop at the left edge. Her full figure survives at every width.
 * `min-h-[37vw]` is the guard on that promise: it keeps the frame under 2.7:1,
 * so cover can never flip to scaling by width and start cutting heads.
 *
 * No scrim. The backdrop under the copy is a light sand (#e0c2a6-#f4dbbf) and
 * navy type clears it about 11:1 on its own; washing it would only mute the
 * photograph.
 *
 * It rides as the section's own CSS background rather than a positioned <img>
 * layer, which is one element and one paint instead of three stacked on a
 * negative z-index.
 *
 * Below `lg` there is no empty half to set type on, so the photo becomes a band
 * between the copy and the cards — and a different crop of it, because the wide
 * frame on a 390px strip would reduce her to a speck.
 */
export function Hero() {
  return (
    <section
      id="top"
      className="relative isolate flex flex-col overflow-hidden bg-[#e8cdb0] lg:h-[calc(100vh-6.5rem)] lg:max-h-[48rem] lg:min-h-[max(32rem,37vw)] lg:bg-[url('/img/hero_wide.jpg')] lg:bg-cover lg:bg-right lg:bg-no-repeat"
    >
      <div className="relative order-1 mx-auto w-full max-w-7xl px-5 pb-10 pt-12 sm:px-8 lg:pb-40 lg:pt-14 xl:pt-20">
        <div className="max-w-xl lg:max-w-md xl:max-w-lg">
          <h1 className="display text-[2.15rem] font-extrabold sm:text-5xl lg:text-[2.75rem] xl:text-[3.5rem]">
            Sell on WhatsApp.
            <br />
            Get paid without the screenshot.
          </h1>

          <p className="measure mt-5 max-w-xl text-base text-brand-950/70 sm:text-lg">
            {site.description}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
      </div>

      {/* The band, below `lg`: cropped to the half of the frame with anything in it. */}
      <div className="relative order-2 aspect-[4/5] w-full sm:aspect-[9/8] lg:hidden">
        <Image
          src="/img/hero_subject.jpg"
          alt="A Nigerian shop owner sitting with her phone, smiling at a payment alert"
          fill
          sizes="100vw"
          priority
          className="object-cover object-right"
        />
      </div>

      {/*
        One grid under the photo on small screens; from `lg` the three cards
        cascade left-to-right across the empty sweep, each one stepped so they
        read as three separate things rather than a stack in a corner. They sit
        below the copy and left of her at every width — at 1024px she begins
        around x=520, which is what holds the `lg` positions in tighter than the
        `xl` ones.

        The wrapper drops to `display:block` at `lg` so the grid's track sizing
        stops applying to children that have left the flow, and the whole
        overlay is pointer-events:none — it covers the CTA, and without that it
        would swallow every click on it. Nothing in it is interactive.
      */}
      <div className="order-3 px-5 pb-12 pt-6 sm:px-8 sm:pt-8 lg:pointer-events-none lg:absolute lg:inset-0 lg:p-0">
        <div className="mx-auto grid w-full max-w-7xl gap-3 sm:grid-cols-3 lg:relative lg:block lg:h-full">
          <FloatCard
            title="Transfer confirmed in"
            value={heroStats.confirm.value}
            note="No screenshot needed"
            className="sm:order-first lg:absolute lg:bottom-10 lg:left-8 lg:w-52"
          />
          <SaleAlertCard
            shop={heroStats.sale.shop}
            amount={heroStats.sale.amount}
            item={heroStats.sale.item}
            when={heroStats.sale.when}
            className="lg:absolute lg:bottom-[9.5rem] lg:left-[12rem] lg:w-60 xl:left-[20rem]"
          />
          <FloatCard
            title="Today's sales · example"
            value={heroStats.ledger.amount}
            note={heroStats.ledger.delta}
            className="sm:order-last lg:absolute lg:bottom-10 lg:left-[17rem] lg:w-52 xl:left-[32rem]"
          />
        </div>
      </div>
    </section>
  );
}
