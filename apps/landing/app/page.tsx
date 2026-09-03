import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { Mission } from "@/components/mission";
import { Features } from "@/components/features";
import { Story } from "@/components/story";
import { Benefits } from "@/components/benefits";
import { HowItWorks } from "@/components/how-it-works";
import { Pricing } from "@/components/pricing";
import { Integrations } from "@/components/integrations";
import { Cta } from "@/components/cta";
import { SiteFooter } from "@/components/site-footer";

/**
 * The page is a stack of full-bleed bands in a deliberate rhythm:
 *
 *   white -> white -> cream -> white -> DARK -> white -> DARK -> lilac
 *   -> photo -> DARK
 *
 * The dark bands are the page's spine and each is separated by a light one, so
 * the eye never meets two in a row. Pricing keeps the near-black treatment
 * deliberately: it is the section a visitor is looking for, and the contrast
 * shift is what makes it findable while scrolling fast.
 */
export default function Page() {
  return (
    <main className="bg-white">
      <SiteHeader />
      <Hero />
      <Mission />
      <Features />
      <Story />
      <Benefits />
      <HowItWorks />
      <Pricing />
      <Integrations />
      <Cta />
      <SiteFooter />
    </main>
  );
}
