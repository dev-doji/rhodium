import { site } from "@/lib/site";
import { Button, WhatsAppIcon } from "./ui";

export function Cta() {
  return (
    <section
      id="cta"
      className="relative overflow-hidden bg-panel px-5 py-16 text-center sm:px-8 sm:py-24"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_0%,rgba(0,51,231,0.45),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-2xl">
        <h2 className="display text-3xl font-bold text-white sm:text-4xl lg:text-[2.75rem]">
          From chat to cash, in seconds
        </h2>
        <p className="measure mx-auto mt-4 max-w-lg text-sm text-brand-100/60 sm:text-base">
          Message the Rhodium bot, list your first product, and send a payment
          request before you finish your next customer&apos;s order.
        </p>
        <Button
          href={site.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 w-full sm:w-auto"
        >
          <WhatsAppIcon />
          Open on WhatsApp
        </Button>
      </div>
    </section>
  );
}
