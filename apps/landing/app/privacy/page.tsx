import type { Metadata } from "next";
import { LegalPage, H2, UL } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy — ${site.name}`,
  description: `How ${site.name} collects, uses and protects merchant and buyer data.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="28 August 2026">
      <p>
        {site.name} is a product of{" "}
        <a
          href={site.companyUrl}
          target="_blank"
          rel="noopener"
          className="text-brand-500 hover:text-brand-600"
        >
          {site.company}
        </a>{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;), the company responsible for the
        data described here. {site.name} helps merchants in Nigeria sell and
        collect payments through WhatsApp and keep their sales records. This
        policy explains what we collect, why, and what you can do about it.
      </p>

      <H2>1. Who we are to you</H2>
      <p>Our role depends on who you are.</p>
      <UL>
        <li>
          <b>If you are a merchant</b> using {site.name} to run your shop, we
          are the controller of your account data.
        </li>
        <li>
          <b>If you are a buyer</b> messaging a merchant&rsquo;s shop, we
          process your messages and order details <b>on that merchant&rsquo;s
          behalf</b>, so they can sell to you and send you a receipt. The
          merchant remains responsible for their own relationship with you.
        </li>
      </UL>

      <H2>2. Information we collect</H2>
      <UL>
        <li>
          <b>Merchant details</b> provided at onboarding: business name,
          WhatsApp phone number, and the bank account used for payouts.
        </li>
        <li>
          <b>Buyer details</b>: the phone number used to place an order, and the
          order and receipt data attached to it.
        </li>
        <li>
          <b>Transaction data</b>: products, orders, payments, and an
          append-only sales ledger.
        </li>
        <li>
          <b>Messages</b> sent to a WhatsApp number connected to {site.name} —
          either our own number or a merchant&rsquo;s — in order to operate the
          shop.
        </li>
        <li>
          <b>Wallet credentials</b>: where a merchant uses an embedded crypto
          wallet, we generate and store its recovery phrase and private key in
          encrypted form so the merchant can recover it. See section 5.
        </li>
      </UL>

      <H2>3. Merchants who connect their own WhatsApp number</H2>
      <p>
        A merchant may connect their own WhatsApp Business number to {site.name}{" "}
        so that buyers message them directly. Where the merchant continues to
        use the WhatsApp Business app on that same number
        (&ldquo;Coexistence&rdquo;), WhatsApp may additionally send us:
      </p>
      <UL>
        <li>
          <b>Prior conversation history</b> — up to the most recent six months
          of messages on that number, including messages exchanged before{" "}
          {site.name} was connected.
        </li>
        <li>
          <b>Contacts</b> saved on that business number.
        </li>
        <li>
          <b>Copies of replies the merchant sends from their own phone</b>, so
          that our automated replies stand down while the merchant is answering
          personally.
        </li>
      </UL>
      <p>
        Only a merchant can authorise this, and only for their own number,
        during the connection flow. We use this data solely to run that
        merchant&rsquo;s shop — to avoid replying over the top of them and to
        keep their order history intact. We do not use it to build profiles, and
        we do not share it with other merchants.
      </p>

      <H2>4. How we use it</H2>
      <p>
        To provide the service: to show a merchant&rsquo;s catalogue, process
        orders, request and confirm payments, send receipts and notifications,
        and maintain the merchant&rsquo;s sales records.{" "}
        <b>We do not sell your personal data</b>, and we do not use message
        content for advertising.
      </p>

      <H2>5. Security</H2>
      <p>
        Personal and financial identifiers — phone numbers, bank account numbers
        and wallet credentials — are encrypted at rest with authenticated
        encryption, and are looked up through a blind index so they need not be
        stored in plain text. Wallet recovery phrases are revealed only to the
        merchant who owns them, and only after a one-time code sent to their
        registered WhatsApp number. Access is limited to what is needed to
        operate the service.
      </p>

      <H2>6. Payments and custody</H2>
      <p>
        Payments settle <b>directly to the merchant</b> — to their own bank
        account via a licensed payment processor, or to their own crypto wallet.{" "}
        {site.name} never takes custody of funds and never holds a balance on
        your behalf.
      </p>

      <H2>7. Third parties</H2>
      <p>
        We share data with these providers only as needed to deliver the
        service:
      </p>
      <UL>
        <li>
          <b>Meta / WhatsApp</b> — to send and receive messages.
        </li>
        <li>
          <b>Monnify</b> — bank transfers and payout settlement.
        </li>
        <li>
          <b>OnSwitch</b> — stablecoin-to-naira settlement, where a buyer pays
          in stablecoin and the merchant is paid in naira.
        </li>
        <li>
          <b>Quai Network</b> — on-chain payments. Blockchain transactions are
          public and permanent by design, and cannot be deleted by us or by you.
        </li>
      </UL>
      <p>Each provider handles data under its own privacy policy.</p>

      <H2 id="data-deletion">8. Retention, deletion and your rights</H2>
      <p>
        We keep transaction and ledger records for as long as needed to provide
        the service and to meet legal and accounting obligations. Conversation
        history received under Coexistence is retained only while the
        merchant&rsquo;s number stays connected, and is deleted when they
        disconnect it.
      </p>
      <p>
        <b>To request deletion of your data</b>, email{" "}
        <a
          href={`mailto:${site.legalEmail}?subject=Data%20deletion%20request`}
          className="text-brand-500 hover:text-brand-600"
        >
          {site.legalEmail}
        </a>{" "}
        from, or quoting, the phone number concerned. State that you want your
        data deleted and we will confirm within 30 days. You may also request
        access to your data or correction of it the same way. A merchant can
        disconnect their WhatsApp number at any time, which stops all further
        collection from it.
      </p>
      <p>
        Two limits we cannot work around: on-chain payment records are public
        and permanent and cannot be erased by anyone, and we may need to retain
        a minimal transaction record where law requires it.
      </p>
      <p>
        We aim to handle personal data in line with the Nigeria Data Protection
        Regulation (NDPR).
      </p>

      <H2>9. Changes</H2>
      <p>
        If we change this policy materially we will update the date above and,
        where the change affects merchants, notify them on WhatsApp.
      </p>

      <H2>10. Contact</H2>
      <p>
        Questions or data requests:{" "}
        <a
          href={`mailto:${site.legalEmail}`}
          className="text-brand-500 hover:text-brand-600"
        >
          {site.legalEmail}
        </a>
        .
      </p>
    </LegalPage>
  );
}
