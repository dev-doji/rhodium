import type { Metadata } from "next";
import { LegalPage, H2, UL } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Terms of Service — ${site.name}`,
  description: `The terms under which merchants and buyers use ${site.name}.`,
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="28 August 2026">
      <p>
        These terms govern your use of {site.name}, a product of{" "}
        <a
          href={site.companyUrl}
          target="_blank"
          rel="noopener"
          className="text-brand-500 hover:text-brand-600"
        >
          {site.company}
        </a>{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By onboarding a shop or placing an
        order through {site.name}, you agree to them.
      </p>

      <H2>1. The service</H2>
      <p>
        {site.name} lets merchants sell products and collect payments through
        WhatsApp, and keeps a sales ledger in naira. Payments settle directly to
        the merchant; {site.name} does not hold funds at any point.
      </p>

      <H2>2. Merchant responsibilities</H2>
      <UL>
        <li>
          The accuracy of your business details and payout account. We settle to
          the account you give us — we cannot recover funds sent to a wrong
          account you supplied.
        </li>
        <li>
          The products you list, their descriptions and prices, and fulfilling
          orders that buyers pay for.
        </li>
        <li>
          Complying with applicable law, tax obligations, and the policies of
          WhatsApp and our payment providers.
        </li>
        <li>
          Keeping control of the WhatsApp number registered to your shop. Anyone
          messaging from it can run vendor commands on your account.
        </li>
      </UL>

      <H2>3. Buyers</H2>
      <p>
        Your purchase contract is with the <b>merchant</b>, not with {site.name}.
        We process the payment and issue the receipt on their behalf. Questions
        about goods, delivery, refunds or returns go to the merchant.
      </p>

      <H2>4. Payments and settlement</H2>
      <UL>
        <li>
          Bank transfers are processed by a licensed payment provider and settle
          to the merchant&rsquo;s own account.
        </li>
        <li>
          Crypto payments settle wallet-to-wallet in a single on-chain
          transaction. <b>On-chain payments are irreversible.</b> Once confirmed
          they cannot be recalled by us, by the merchant, or by you.
        </li>
        <li>
          Naira values shown for crypto payments use an exchange rate at the
          time of quoting. Rates move; the amount displayed at checkout is the
          amount that settles.
        </li>
      </UL>

      <H2>5. Embedded wallets</H2>
      <p>
        Where we generate a crypto wallet for a merchant, the recovery phrase is
        encrypted and revealed only to that merchant after a one-time code.{" "}
        <b>
          If you lose your recovery phrase and lose access to your registered
          WhatsApp number, the funds cannot be recovered
        </b>{" "}
        — not by us and not by anyone else. Back it up.
      </p>

      <H2>6. Acceptable use</H2>
      <p>
        Do not use {site.name} for unlawful goods or services, fraud, money
        laundering, or activity that breaches WhatsApp&rsquo;s or a payment
        provider&rsquo;s policies. We may suspend a shop that does, without
        notice where the law requires it.
      </p>

      <H2>7. Availability</H2>
      <p>
        We work to keep the service running but do not guarantee uninterrupted
        availability. Payment rails, WhatsApp and blockchain networks are
        operated by third parties and can fail independently of us.
      </p>

      <H2>8. Liability</H2>
      <p>
        To the fullest extent permitted by law, {site.name} is not liable for
        indirect or consequential losses, for the acts or omissions of merchants
        or buyers, or for losses arising from irreversible on-chain transactions
        or from credentials you failed to safeguard.
      </p>

      <H2>9. Changes and termination</H2>
      <p>
        We may update these terms; material changes will be dated here and
        notified to merchants on WhatsApp. You may stop using {site.name} at any
        time, and a merchant may disconnect their WhatsApp number whenever they
        choose.
      </p>

      <H2>10. Contact</H2>
      <p>
        <a
          href={`mailto:${site.legalEmail}`}
          className="text-brand-500 hover:text-brand-600"
        >
          {site.legalEmail}
        </a>
      </p>
    </LegalPage>
  );
}
