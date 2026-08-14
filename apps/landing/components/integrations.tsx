import { integrations, site } from "@/lib/site";
import { marks } from "./logos";
import { Button, SectionLabel, WhatsAppIcon } from "./ui";

export function Integrations() {
  return (
    <section
      id="integrations"
      className="bg-white px-5 py-16 sm:px-8 sm:py-24"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionLabel>Built on</SectionLabel>
          <h2 className="display mt-5 text-3xl font-bold sm:text-4xl">
            Rails your buyers already trust
          </h2>
          <p className="measure mt-4 text-sm text-brand-950/60 sm:text-base">
            Rhodium sits on the WhatsApp Cloud API your customers use every day,
            a licensed Nigerian bank rail for transfers, and Quai Network with
            BlipPay for buyers who hold crypto. Every rail settles to you.
          </p>

          <Button
            href={site.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8"
          >
            <WhatsAppIcon />
            Start selling
          </Button>
        </div>

        <div className="rounded-4xl bg-brand-50 p-5 ring-1 ring-brand-100 sm:p-8">
          {/* To use an official logo instead of a monogram, drop the SVG into
              public/img/logos/ and swap the entry in components/logos.tsx. */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {integrations.map((item) => (
              <div
                key={item.name}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-white px-2 text-center shadow-sm shadow-brand-950/5 ring-1 ring-brand-100/70 transition-transform duration-200 hover:-translate-y-0.5"
              >
                {marks[item.mark]}
                <div>
                  <p className="text-xs font-bold tracking-tight text-brand-950 sm:text-sm">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-[10px] text-brand-950/45">
                    {item.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
