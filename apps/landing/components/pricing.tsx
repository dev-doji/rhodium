import { Check } from "lucide-react";
import { enterprisePlan, plans, site } from "@/lib/site";
import { Button, SectionLabel, WhatsAppIcon } from "./ui";

export function Pricing() {
  return (
    <section id="pricing" className="bg-ink px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <SectionLabel tone="dark" align="center">
            Pricing
          </SectionLabel>
          <h2 className="display mt-5 text-3xl font-bold text-white sm:text-4xl lg:text-[2.75rem]">
            Plans that scale with
            <br className="hidden sm:block" /> your sales, not your stress
          </h2>
          <p className="measure mx-auto mt-4 max-w-lg text-sm text-white/50 sm:text-base">
            Start free on the bank rail. Move up when you want crypto payments
            and the traction dashboard.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`flex flex-col rounded-4xl p-7 ring-1 ${
                plan.featured
                  ? "bg-panel ring-brand-400/40"
                  : "bg-white/[0.04] ring-white/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                {plan.featured && (
                  <span className="rounded-full bg-accent-500 px-2.5 py-1 text-[11px] font-semibold text-white">
                    Most popular
                  </span>
                )}
              </div>

              <p className="measure mt-2 text-sm leading-relaxed text-white/50">
                {plan.blurb}
              </p>

              <p className="mt-7 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight text-white">
                  {plan.price}
                </span>
                <span className="text-sm text-white/45">{plan.period}</span>
              </p>

              <Button
                href={site.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant={plan.featured ? "primary" : "ghost"}
                className="mt-6 w-full"
              >
                <WhatsAppIcon />
                {plan.cta}
              </Button>

              <p className="mt-7 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                Features
              </p>
              <ul className="mt-3 space-y-2.5">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm text-white/70"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    {feature}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        {/* Wide third card, as in the reference design */}
        <div className="mt-4 rounded-4xl bg-brand-900 p-7 text-center ring-1 ring-brand-400/30 sm:p-9">
          <h3 className="text-lg font-semibold text-white">
            {enterprisePlan.name}
          </h3>
          <p className="measure mx-auto mt-2 max-w-md text-sm leading-relaxed text-brand-100/60">
            {enterprisePlan.blurb}
          </p>
          <Button
            href={site.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6"
          >
            <WhatsAppIcon />
            {enterprisePlan.cta}
          </Button>
        </div>
      </div>
    </section>
  );
}
