import { Check } from "lucide-react";
import { mission } from "@/lib/site";
import { PhotoSlot, SectionLabel } from "./ui";

/**
 * Photograph on the left, claim and checklist on the right.
 *
 * On phones the text comes first and the photograph second: the visitor has
 * just read the headline and wants the explanation, not another picture
 * before it.
 */
export function Mission() {
  return (
    <section id="mission" className="bg-white py-16 sm:py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <PhotoSlot
          alt="A seller packing an order at her counter"
          src="/img/woman_one.jpg"
          className="order-2 aspect-[4/3] w-full lg:order-1 lg:aspect-[5/6]"
          sizes="(max-width: 1024px) 100vw, 50vw"
        />

        <div className="order-1 lg:order-2">
          <SectionLabel>{mission.label}</SectionLabel>

          <h2 className="display mt-4 text-[1.85rem] font-extrabold sm:text-4xl lg:text-[2.75rem]">
            {mission.title}
          </h2>

          {mission.body.map((para) => (
            <p key={para} className="measure mt-4 text-brand-950/60">
              {para}
            </p>
          ))}

          <ul className="mt-7 space-y-0">
            {mission.points.map((point) => (
              <li
                key={point}
                className="flex items-center gap-3 border-b border-brand-950/8 py-3 text-[15px] text-brand-950/80 last:border-b-0"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500">
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
