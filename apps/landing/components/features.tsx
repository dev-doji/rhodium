import {
  ArrowUpRight,
  BookOpen,
  Coins,
  MessageCircle,
  Receipt,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { features } from "@/lib/site";
import { SectionLabel } from "./ui";

const icons: Record<string, LucideIcon> = {
  MessageCircle,
  ShieldCheck,
  Coins,
  BookOpen,
  Receipt,
  TrendingUp,
};

export function Features() {
  return (
    <section id="features" className="bg-panel px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <SectionLabel tone="dark" align="center">
            What you get
          </SectionLabel>
          <h2 className="display mt-5 text-3xl font-bold text-white sm:text-4xl lg:text-[2.75rem]">
            Everything a WhatsApp seller
            <br className="hidden sm:block" /> needs to get paid
          </h2>
          <p className="measure mx-auto mt-4 max-w-lg text-sm text-brand-100/60 sm:text-base">
            One chat, two payment rails, and a set of books that stay right
            without you doing anything about it.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = icons[feature.icon] ?? MessageCircle;
            return (
              <article
                key={feature.title}
                className="group relative rounded-3xl bg-panel-soft/60 p-6 ring-1 ring-white/10 transition-colors duration-200 hover:bg-panel-soft hover:ring-white/20"
              >
                <div className="flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
                    <Icon className="h-5 w-5 text-brand-200" />
                  </span>
                  <ArrowUpRight className="h-5 w-5 text-white/25 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent-400" />
                </div>

                <h3 className="mt-14 text-lg font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="measure mt-2 text-sm leading-relaxed text-brand-100/55">
                  {feature.body}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
