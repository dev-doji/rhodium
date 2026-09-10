import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { heroStats, site } from "@/lib/site";
import { Button, FloatCard, SaleAlertCard, WhatsAppIcon } from "./ui";

/**
 * The photograph IS the hero: full-bleed, with the copy set over it.
 *
 * Two facts about the file decide the whole layout. It is square, and its
 * subject sits centre-right against an otherwise empty backdrop. So from `lg`
 * the picture becomes the section's background and the copy takes the empty
 * left of it — the one place text can sit without covering her.
 *
 * That leaves the copy column narrow on purpose. At exactly 1024px the image is
 * shown at native size and her face begins around x=480, so a wider column
 * would run into it; the cream wash reaches 30% and is gone by 58%, well clear
 * of her, rather than veiling the subject to make room for words.
 *
 * Below `lg` there is no empty left to use — the photo is a full-width band
 * under the copy instead, with the cards below it. `flex` plus `order` does
 * that with one image element rather than one per breakpoint.
 */
export function Hero() {
  return (
    <section
      id="top"
      className="relative isolate flex flex-col overflow-hidden bg-cream"
    >
      <div className="relative order-1 mx-auto w-full max-w-7xl px-5 pb-10 pt-12 sm:px-8 lg:min-h-[42rem] lg:pb-40 lg:pt-28">
        <div className="max-w-xl lg:max-w-md xl:max-w-lg">
          <h1 className="display text-[2.15rem] font-extrabold sm:text-5xl lg:text-[3rem] xl:text-[3.5rem]">
            Sell on WhatsApp.
            <br />
            Get paid without the screenshot.
          </h1>

          <p className="measure mt-5 max-w-xl text-base text-brand-950/65 sm:text-lg">
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

      <div className="relative order-2 aspect-[4/5] w-full sm:aspect-[16/10] lg:absolute lg:inset-0 lg:-z-10 lg:aspect-auto">
        <Image
          src="/img/hero_cover.jpg"
          alt="A Nigerian shop owner sitting with her phone, smiling at a payment alert"
          fill
          sizes="100vw"
          priority
          // Portrait frame on phones, so the crop is horizontal: anchored right
          // of centre to drop the studio light and its stand foot on the left.
          // Landscape from `sm`, so the crop turns vertical: anchored high, to
          // keep her face and lose the floor.
          className="object-cover object-[72%_50%] sm:object-[50%_18%]"
        />
        {/*
          The wash that makes the copy legible, and only from `lg`, where copy
          is actually over the picture. It is opaque cream to 30% and gone by
          58% — the backdrop behind the words is a mid-taupe (#887459), which
          dark navy type does not clear on its own.
        */}
        <div
          aria-hidden
          className="absolute inset-0 hidden bg-gradient-to-r from-cream from-30% to-transparent to-58% lg:block"
        />
      </div>
      {/*
        One grid under the photo on small screens; three cards placed over it
        from `lg`, where the wrapper drops to `display:block` so the grid's
        track sizing stops applying to children that have left the flow. The
        alert sits right, beside her phone rather than beside the copy.

        The `lg` overlay covers the whole hero, including the buttons, so it is
        pointer-events:none — otherwise it would swallow every click on the CTA
        underneath it. Nothing in it is interactive, so nothing is lost.
      */}
      <div className="order-3 px-5 pb-12 pt-6 sm:px-8 sm:pt-8 lg:pointer-events-none lg:absolute lg:inset-0 lg:p-0">
        <div className="mx-auto grid w-full max-w-7xl gap-3 sm:grid-cols-3 lg:relative lg:block lg:h-full">
          <FloatCard
            title="Transfer confirmed in"
            value={heroStats.confirm.value}
            note="No screenshot needed"
            className="lg:absolute lg:bottom-14 lg:left-8 lg:w-52"
          />
          <FloatCard
            title="Today's sales · example"
            value={heroStats.ledger.amount}
            note={heroStats.ledger.delta}
            className="lg:absolute lg:bottom-14 lg:left-64 lg:w-52"
          />
          <SaleAlertCard
            shop={heroStats.sale.shop}
            amount={heroStats.sale.amount}
            item={heroStats.sale.item}
            when={heroStats.sale.when}
            className="lg:absolute lg:right-8 lg:top-24 lg:w-64"
          />
        </div>
      </div>
    </section>
  );
}
