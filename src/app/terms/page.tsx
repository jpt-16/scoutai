import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Use — ScoutCard AI",
  description: "The terms for using ScoutCard AI's free CSV tools and paid AI film import.",
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Use" lastUpdated="[insert launch date]">
      <p>
        These terms cover your use of ScoutCard AI (&ldquo;the service&rdquo;). By using it, you
        agree to them. If you don&apos;t agree, don&apos;t use the service.
      </p>

      <LegalSection title="What the service is">
        <p>
          ScoutCard AI turns a Hudl breakdown CSV (or, on the paid tier, game film) into scout team
          cards for high school football coaching staffs. The CSV import, card generation, editing,
          and printing are free and run entirely in your browser, with no account required. AI film
          import is a separate, optional, paid feature, billed per coaching staff.
        </p>
      </LegalSection>

      <LegalSection title="Your account and team">
        <p>
          To use AI film import you create an account and a team for your coaching staff. You&apos;re
          responsible for what happens under your account, including other coaches you invite to
          your team, and for keeping your sign-in secure.
        </p>
      </LegalSection>

      <LegalSection title="Content you upload">
        <p>
          You&apos;re responsible for the CSVs and game film you upload. By uploading content, you
          represent that you have the right to use and share it through this service — including any
          consent your school, league, or conference requires, particularly given that game film of
          high school athletes may include images of minors. We may remove content or suspend an
          account we believe violates this.
        </p>
      </LegalSection>

      <LegalSection title="AI-detected routes are a starting point, not a measurement">
        <p>
          The AI film import feature is the vision model&apos;s own best guess at player routes from
          a single camera angle — it is not a calibrated, measured result. Always review and correct
          AI-generated cards before relying on them; the service is provided to help you draft cards
          faster, not to guarantee accuracy.
        </p>
      </LegalSection>

      <LegalSection title="Subscriptions and billing">
        <p>
          AI film import is billed on a recurring subscription through Stripe, per coaching staff.
          You can cancel anytime through the billing portal in the app; cancellation stops future
          billing but doesn&apos;t retroactively refund the current period unless we say otherwise.
          Pricing may change; we&apos;ll give you notice before a price change takes effect on your
          subscription.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to:</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>Upload content you don&apos;t have the right to share.</li>
          <li>Use the service to violate any school, league, or conference rule or policy.</li>
          <li>Attempt to disrupt, overload, or reverse-engineer the service.</li>
          <li>Use the service for anything unlawful.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Disclaimer of warranties">
        <p>
          The service is provided &ldquo;as is,&rdquo; without warranties of any kind, express or
          implied. We don&apos;t guarantee the service will be uninterrupted, error-free, or that
          AI-generated content will be accurate.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, ScoutCard AI won&apos;t be liable for indirect,
          incidental, or consequential damages arising from your use of the service, including
          decisions made based on AI-generated scout cards.
        </p>
      </LegalSection>

      <LegalSection title="Termination">
        <p>
          You can stop using the service and cancel your subscription at any time. We may suspend or
          terminate accounts that violate these terms.
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          We may update these terms as the product changes. We&apos;ll update the date at the top of
          this page when we do; continued use after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>These terms are governed by the laws of [insert your state/country], without regard to conflict-of-law rules.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms:{" "}
          <a href="mailto:support@scoutcardai.com" className="font-semibold text-primary underline-offset-4 hover:underline">
            support@scoutcardai.com
          </a>{" "}
          <span className="text-sm text-muted-foreground">(placeholder — replace with your real inbox)</span>.
        </p>
      </LegalSection>

      <p className="border-t pt-6 text-sm text-muted-foreground">
        This page is a starting draft based on how the product actually works today, not legal
        advice. Have it reviewed by a lawyer — especially given payment processing and game film
        that may include images of minors — before relying on it for a live product.
      </p>
    </LegalLayout>
  );
}
