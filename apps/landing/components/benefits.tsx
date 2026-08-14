import { CircleCheck } from "lucide-react";
import { benefits } from "@/lib/site";
import { SectionLabel } from "./ui";

export function Benefits() {
  return (
    <section id="benefits" className="bg-brand-50/60 px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <TractionMock />

        <div>
          <SectionLabel>Why it holds up</SectionLabel>
          <h2 className="display mt-5 text-3xl font-bold sm:text-4xl">
            Books you can hand to your accountant without apologising
          </h2>
          <p className="measure mt-4 text-sm text-brand-950/60 sm:text-base">
            The guarantees below are enforced in code and covered by tests — not
            promises in a help article.
          </p>

          <ul className="mt-8 space-y-6">
            {benefits.map((benefit) => (
              <li key={benefit.title} className="flex gap-3.5">
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
                <div>
                  <h3 className="text-base font-semibold">{benefit.title}</h3>
                  <p className="measure mt-1.5 text-sm leading-relaxed text-brand-950/60">
                    {benefit.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** A stylised traction dashboard — illustrative UI, not live data. */
function TractionMock() {
  const rails = [
    { label: "Bank transfer", value: 72 },
    { label: "Crypto (Quai)", value: 21 },
    { label: "Pending", value: 7 },
  ];
  const bars = [42, 68, 55, 88, 74, 96];

  return (
    <div className="relative">
      {/* Extra bottom padding so the floating card below overlaps padding
          rather than covering the chart on narrow screens. */}
      <div className="rounded-4xl bg-white p-6 pb-16 shadow-2xl shadow-brand-950/10 ring-1 ring-brand-100 sm:p-8 sm:pb-8">
        <p className="text-xs font-medium text-brand-950/50">Gross merchandise value</p>
        <p className="mt-1 text-3xl font-bold tracking-tight">₦4,182,600</p>

        <ul className="mt-6 space-y-3.5">
          {rails.map((rail) => (
            <li key={rail.label}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-brand-950/70">{rail.label}</span>
                <span className="font-semibold text-brand-950/50">
                  {rail.value}%
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-brand-50">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${rail.value}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div
          aria-hidden
          className="mt-7 flex h-24 items-end gap-2 border-t border-brand-100 pt-6"
        >
          {bars.map((height, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-md ${
                i === bars.length - 1 ? "bg-accent-500" : "bg-brand-900"
              }`}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>

      {/* Floating card, echoing the reference layout */}
      <div className="absolute bottom-4 right-4 w-44 rounded-2xl bg-white p-4 shadow-2xl shadow-brand-950/15 ring-1 ring-brand-100 sm:-bottom-6 sm:-left-6 sm:right-auto sm:w-52">
        <p className="text-[11px] font-medium text-brand-950/50">Unique buyers</p>
        <p className="mt-0.5 text-xl font-bold tracking-tight">1,204</p>
        <p className="mt-1 text-[11px] font-semibold text-brand-500">
          +128 this month
        </p>
      </div>
    </div>
  );
}
