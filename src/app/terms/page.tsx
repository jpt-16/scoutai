import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Use — ScoutCard AI",
  description: "The terms for using ScoutCard AI's scout cards, playbook, practice playsheet and AI features.",
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Use" lastUpdated="October 9, 2026">
      <p>
        These terms cover your use of ScoutCard AI (&ldquo;the service&rdquo;). By using it, you
        agree to them. If you don&apos;t agree, don&apos;t use the service.
      </p>

      <LegalSection title="What the service is">
        <p>
          ScoutCard AI turns a Hudl breakdown (a CSV, an Excel file or pasted rows) into scout team
          cards for high school football coaching staffs. It also lets a staff load its own playbook
          to study and build a practice playsheet. Reading your files, drawing cards, editing,
          printing and exporting happen in your browser. Some features use AI: reviewing plays the
          app couldn&apos;t place, drawing a play from a typed call, and reading the opponent&apos;s
          secondary from a pre-snap clip. See the Privacy Policy for what each one sends.
        </p>
      </LegalSection>

      <LegalSection title="Private pilot and your account">
        <p>
          ScoutCard AI is currently in a private pilot with coaching staffs. Using the app requires
          an account, and access is by invitation. You&apos;re responsible for what happens under
          your account, including the coaches you invite to your team, and for keeping your sign-in
          secure. We may change, limit or end the pilot, or any feature in it, at any time. The
          five-play demo is open without an account.
        </p>
      </LegalSection>

      <LegalSection title="Content you upload">
        <p>
          You&apos;re responsible for the breakdowns, playbooks, plays and film you upload. By
          uploading content, you represent that you have the right to use and share it through this
          service, including any consent your school, league or conference requires, particularly
          given that game film of high school athletes may include images of minors. We may remove
          content or suspend an account we believe violates this.
        </p>
      </LegalSection>

      <LegalSection title="AI-assisted content is a starting point">
        <p>
          Where the AI fills in a play, draws a card or reads a secondary from film, the result is
          its best guess, not a measurement. Plays the AI touched are marked &ldquo;AI&rdquo; in the
          app. Always review and correct them before you rely on them; the service is provided to
          help you prepare faster, not to guarantee accuracy.
        </p>
      </LegalSection>

      <LegalSection title="Subscriptions and billing">
        <p>
          Where your staff has a paid plan, it&apos;s billed on a recurring subscription through
          Stripe, per coaching staff. You can cancel anytime through the billing portal in the app;
          cancellation stops future billing but doesn&apos;t retroactively refund the current period
          unless we say otherwise. Pricing may change; we&apos;ll give you notice before a price
          change takes effect on your subscription.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to:</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>Upload content you don&apos;t have the right to share.</li>
          <li>Use the service to violate any school, league or conference rule or policy.</li>
          <li>Attempt to disrupt, overload, bypass the usage limits of, or reverse-engineer the service.</li>
          <li>Share your sign-in, or use the service for anything unlawful.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Third-party names">
        <p>
          Hudl, The CoachPad and other product names are the property of their owners. ScoutCard AI
          isn&apos;t affiliated with or endorsed by Hudl or The CoachPad; it reads files exported from
          Hudl and makes files other tools can open.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer of warranties">
        <p>
          The service is provided &ldquo;as is,&rdquo; without warranties of any kind, express or
          implied. We don&apos;t guarantee the service will be uninterrupted or error-free, or that
          AI-generated content will be accurate. Your scripts are saved in your own browser, and we
          can&apos;t recover them if that data is cleared.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, ScoutCard AI won&apos;t be liable for indirect,
          incidental or consequential damages arising from your use of the service, including
          decisions made based on scout cards or AI-generated content.
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
          <a href="mailto:jake@jtbuildsco.com" className="font-semibold text-primary underline-offset-4 hover:underline">
            jake@jtbuildsco.com
          </a>
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
