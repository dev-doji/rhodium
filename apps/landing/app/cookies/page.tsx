import type { Metadata } from "next";
import { LegalPage, H2, UL } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Cookie Policy — ${site.name}`,
  description: `What ${site.name} stores in your browser, and why.`,
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim is checkable against the source: the dashboard's bearer token
 * is the ONLY thing stored (dashboard/src/api.ts), the storefront keeps its
 * basket in memory and persists nothing, and there are no analytics or
 * advertising scripts anywhere in the app.
 *
 * A cookie policy describing behaviour a product does not have is worse than
 * none — it invites a complaint about something that never happened, and it
 * teaches the team the document is decorative. The first draft of this page
 * claimed the basket was saved to local storage; the code says otherwise, so
 * the claim went rather than the check.
 */
export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="7 September 2026">
      <p>
        This explains what {site.name} stores in your browser or on your device.
        We have tried to make it specific rather than generic: it lists what we
        actually store, and nothing we do not.
      </p>

      <H2>1. The short version</H2>
      <p>
        <b>
          We do not use advertising cookies, tracking pixels, or third-party
          analytics.
        </b>{" "}
        We do not sell or share browsing data, and we do not build advertising
        profiles. In fact we set <b>no cookies at all</b>. The only thing kept
        on your device is a sign-in token, and only if you are a seller.
      </p>

      <H2>2. What we store, and why</H2>
      <p>
        <b>We set no cookies of our own at all.</b> The one thing we keep is
        stored by your browser using <i>local storage</i>, which is not sent
        with network requests and is not readable by other sites.
      </p>
      <UL>
        <li>
          <b>Your sign-in, if you are a seller</b> — after you sign in to the
          seller dashboard with the code we text you, a token is kept so you
          are not asked to sign in again on every page. Signing out removes it,
          and so does clearing site data.
        </li>
      </UL>
      <p>
        <b>Buyers: we store nothing.</b> Your basket on a seller&rsquo;s shop
        page lives only in the page while it is open — refreshing or closing
        the tab clears it, because it was never saved anywhere. The phone
        number and name you type at checkout are sent with your order so the
        seller can deliver to you and send a receipt; they are covered by our{" "}
        <a href="/privacy" className="text-brand-500 hover:text-brand-600">
          Privacy Policy
        </a>
        , not by this page.
      </p>
      <p>
        Because we set no cookies and store nothing for buyers, we do not show
        a cookie consent banner. If that ever changes — if we add analytics, or
        anything that follows you between sites — we will ask you first rather
        than update this page quietly.
      </p>

      <H2>3. What our payment partners may set</H2>
      <p>
        Paying happens on our checkout page, but the money moves through
        regulated payment providers. When a payment is being processed, those
        providers may set their own cookies for fraud prevention and security —
        that is their processing, under their own policies, and we do not
        control it.
      </p>
      <UL>
        <li>
          <b>Paystack</b> — bank transfers and card payments.
        </li>
        <li>
          <b>OnSwitch</b> — where a buyer pays in stablecoin and the seller is
          paid in naira.
        </li>
        <li>
          <b>Your own crypto wallet</b> — if you choose to pay on-chain, your
          wallet (MetaMask, Trust, and so on) is software you installed. It has
          its own policy and we cannot see inside it.
        </li>
      </UL>

      <H2>4. Server logs</H2>
      <p>
        Separately from your browser, our servers keep short-lived technical
        logs — the time of a request, the page, and the IP address it came
        from. We use these to keep the service running and to stop abuse: for
        example, we count sign-in code requests per number and per IP address
        so nobody can use us to spam someone with text messages. These logs are
        not used to profile you or to advertise to you.
      </p>

      <H2>5. Controlling what is stored</H2>
      <UL>
        <li>
          Clearing site data in your browser removes the sign-in token. If you
          are a seller you will be signed out; if you are a buyer there is
          nothing of yours to remove.
        </li>
        <li>
          Blocking storage for this site is fine — shopping and paying work
          exactly the same. Sellers will just be asked to sign in more often.
        </li>
        <li>
          Private or incognito windows discard all of it when you close them.
        </li>
      </UL>

      <H2>6. Changes</H2>
      <p>
        If what we store changes, this page changes with it and the date at the
        top moves. Material changes to how we handle your data are covered by
        our{" "}
        <a href="/privacy" className="text-brand-500 hover:text-brand-600">
          Privacy Policy
        </a>
        .
      </p>

      <H2>7. Contact</H2>
      <p>
        Questions about this policy go to{" "}
        <a
          href={`mailto:${site.legalEmail}`}
          className="text-brand-500 hover:text-brand-600"
        >
          {site.legalEmail}
        </a>
        , which reaches {site.company}, the company behind {site.name}.
      </p>
    </LegalPage>
  );
}
