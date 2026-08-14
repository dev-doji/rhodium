import Image from "next/image";
import { MessageSquare, Wallet, BellRing, type LucideIcon } from "lucide-react";
import { howItWorks } from "@/lib/site";
import { SectionLabel } from "./ui";

const stepIcons: LucideIcon[] = [MessageSquare, Wallet, BellRing];

export function HowItWorks() {
  return (
    <section id="how" className="bg-white px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="relative order-2 overflow-hidden rounded-4xl lg:order-1">
            <Image
              src="/img/woman_one.jpg"
              alt="A shopkeeper handing a wrapped order to a customer"
              width={1024}
              height={1024}
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="h-72 w-full object-cover sm:h-96 lg:h-[30rem]"
            />

            {/* The confirmation the merchant actually sees, floated over the photo */}
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-white/95 p-4 shadow-xl shadow-brand-950/15 backdrop-blur sm:right-auto sm:max-w-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                <p className="text-xs font-semibold text-brand-950">
                  Payment confirmed
                </p>
              </div>
              <p className="mt-1.5 text-sm text-brand-950/60">
                ₦12,500 from Ada landed in your account. Receipt sent, stock
                updated.
              </p>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="display mt-5 text-3xl font-bold sm:text-4xl">
              From chat to confirmed sale, in three steps
            </h2>
            <p className="measure mt-4 text-sm text-brand-950/60 sm:text-base">
              Nothing new to learn and nothing to install. You keep selling the
              way you already sell — Rhodium handles the money and the records.
            </p>

            <ol className="mt-8 space-y-5">
              {howItWorks.map((step, i) => {
                const Icon = stepIcons[i] ?? MessageSquare;
                return (
                  <li key={step.step} className="flex gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 ring-1 ring-brand-100">
                      <Icon className="h-5 w-5 text-brand-500" />
                    </span>
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-semibold">
                        <span className="text-xs font-bold text-accent-500">
                          {step.step}
                        </span>
                        {step.title}
                      </h3>
                      <p className="measure mt-1 text-sm leading-relaxed text-brand-950/60">
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
