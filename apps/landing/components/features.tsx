import {
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

/**
 * The capability strip: a quiet, evenly weighted grid on the cream band.
 *
 * Every card carries the same visual weight on purpose. This is the section a
 * visitor scans rather than reads, and promoting one card would send them
 * looking for a hierarchy that does not exist.
 */
export function Features() {
  return (
    <section
      id="features"
      className="border-y border-brand-950/8 bg-cream px-5 py-16 sm:px-8 sm:py-20"
    >
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <SectionLabel>What you get</SectionLabel>
          <h2 className="display mt-4 text-[1.85rem] font-extrabold sm:text-4xl">
            Everything a WhatsApp seller needs to get paid
          </h2>
        </div>

        <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = icons[feature.icon] ?? MessageCircle;
            return (
              <div key={feature.title}>
                <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-white text-brand-500 ring-1 ring-brand-950/8">
                  <Icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <h3 className="text-[15px] font-bold tracking-tight">
                  {feature.title}
                </h3>
                <p className="measure mt-1.5 text-sm leading-relaxed text-brand-950/60">
                  {feature.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
