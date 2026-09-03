import { Coins, RefreshCcw, ShieldCheck, type LucideIcon } from "lucide-react";
import { benefits, proofStats } from "@/lib/site";
import { SectionLabel } from "./ui";

const icons: LucideIcon[] = [ShieldCheck, RefreshCcw, Coins];

/**
 * The dark band: heading on the left, a bento of guarantees on the right, and
 * three figures beneath.
 *
 * The figures are product facts — confirmation time, rail count, and the
 * amount we ever hold — rather than traction numbers, because we have not
 * launched. Inventing "12K+ sellers" here would be the single most damaging
 * sentence on the page the first time a real one asked about it.
 */
export function Benefits() {
  return (
    <section
      id="benefits"
      className="bg-panel px-5 py-16 text-white sm:px-8 sm:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <div>
            <SectionLabel tone="dark">Why choose Rhodium</SectionLabel>
            <h2 className="display mt-4 text-[1.85rem] font-extrabold sm:text-4xl lg:text-[2.75rem]">
              The money moves
              <br className="hidden sm:block" /> before you trust anyone.
            </h2>
            <p className="measure mt-5 max-w-md text-brand-100/60">
              Three guarantees that hold whether you take one order a week or a
              hundred a day.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {benefits.map((benefit, i) => {
              const Icon = icons[i] ?? ShieldCheck;
              return (
                <article
                  key={benefit.title}
                  className={`rounded-none bg-panel-soft/70 p-6 border border-white/10 transition-colors duration-200 hover:bg-panel-soft ${
                    // The first card spans both columns, so the bento reads as
                    // a composition rather than a plain three-up grid.
                    i === 0 ? "sm:col-span-2" : ""
                  }`}
                >
                  <span className="mb-4 grid h-10 w-10 place-items-center rounded-none bg-white/10 text-brand-200">
                    <Icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <h3 className="text-base font-bold tracking-tight">
                    {benefit.title}
                  </h3>
                  <p className="measure mt-2 text-sm leading-relaxed text-brand-100/60">
                    {benefit.body}
                  </p>
                </article>
              );
            })}
          </div>
        </div>

        <dl className="mt-14 grid grid-cols-1 gap-8 border-t border-white/10 pt-10 sm:grid-cols-3 sm:gap-4">
          {proofStats.map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <p className="display text-5xl font-extrabold tabular-nums sm:text-6xl lg:text-7xl">
                  {stat.value}
                </p>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-100/70">
                  {stat.label}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
