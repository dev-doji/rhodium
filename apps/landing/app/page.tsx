import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { HowItWorks } from "@/components/how-it-works";
import { Benefits } from "@/components/benefits";
import { Pricing } from "@/components/pricing";
import { Integrations } from "@/components/integrations";
import { Cta } from "@/components/cta";
import { SiteFooter } from "@/components/site-footer";

export default function Page() {
  return (
    <main className="bg-white">
      <SiteHeader />
      <Hero />
      <Features />
      <HowItWorks />
      <Benefits />
      <Pricing />
      <Integrations />
      <Cta />
      <SiteFooter />
    </main>
  );
}
