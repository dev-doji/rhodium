import { integrations, site } from "@/lib/site";
import { marks } from "./logos";
import { SectionLabel } from "./ui";

/**
 * The lilac band: what Rhodium is built on.
 *
 * Centred, because unlike the mission and story bands this is a list of peers
 * with no narrative order — nothing here is more important than the rest, so
 * nothing gets the left-hand starting position.
 */
export function Integrations() {
  return (
    <section id="integrations" className="bg-tint px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-5xl text-center">
        <SectionLabel align="center">Built on</SectionLabel>

        <h2 className="display mt-4 text-[1.85rem] font-extrabold sm:text-4xl lg:text-[2.75rem]">
          Rails your buyers
          <br className="hidden sm:block" /> already trust
        </h2>
        <p className="measure mx-auto mt-4 max-w-lg text-brand-950/60">
          Rhodium does not ask anyone to learn a new way to pay. It sits on the
          networks and wallets Nigerian buyers and sellers use today.
        </p>

        <ul className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
          {integrations.map((item) => (
            <li
              key={item.name}
              className="flex items-center gap-3 rounded-none bg-white/70 p-4 text-left border border-brand-950/6 transition-colors duration-200 hover:bg-white"
            >
              {marks[item.mark]}
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold tracking-tight">
                  {item.name}
                </span>
                <span className="block truncate text-xs text-brand-950/65">
                  {item.note}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-xs text-brand-950/60">
          Operated by{" "}
          <a
            href={site.companyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-600 underline underline-offset-2"
          >
            {site.company}
          </a>
        </p>
      </div>
    </section>
  );
}
