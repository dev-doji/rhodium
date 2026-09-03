import { story } from "@/lib/site";
import { PhotoSlot, SectionLabel } from "./ui";

/** Text left, photograph right — the mirror of the mission band above it. */
export function Story() {
  return (
    <section className="bg-white py-16 sm:py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionLabel>{story.label}</SectionLabel>
          <h2 className="display mt-4 text-[1.85rem] font-extrabold sm:text-4xl lg:text-[2.75rem]">
            {story.title}
          </h2>
          {story.body.map((para) => (
            <p key={para} className="measure mt-4 text-brand-950/60">
              {para}
            </p>
          ))}
        </div>

        <PhotoSlot
          alt="A sneaker seller listing stock from his phone"
          src="/img/man_one.jpg"
          className="aspect-[4/3] w-full lg:aspect-[5/4]"
          sizes="(max-width: 1024px) 100vw, 50vw"
        />
      </div>
    </section>
  );
}
