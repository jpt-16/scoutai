import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy — ScoutCard AI",
  description: "How ScoutCard AI handles your data — the free CSV path, and the paid AI film feature.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="[insert launch date]">
      <p>
        This policy explains what ScoutCard AI does and doesn&apos;t do with your data. The short
        version: the CSV import, scout cards, and print tools never send anything to a server —
        they run entirely in your browser. The optional, paid AI film feature is different, and is
        covered in detail below.
      </p>

      <LegalSection title="The free CSV path: nothing leaves your device">
        <p>
          Uploading a Hudl breakdown CSV, generating scout cards, editing plays, drawing on cards,
          and printing all happen entirely client-side, in your browser. The file is parsed on your
          device and never uploaded to us or any third party. The resulting script is stored only in
          your browser&apos;s local storage, on your device — we have no server-side database and no
          way to see, back up, or recover it. Clearing your browser data or switching devices means
          starting over unless you re-import the CSV.
        </p>
      </LegalSection>

      <LegalSection title="If you create an account (AI film import)">
        <p>
          The AI game-film import feature requires signing in and is billed per coaching staff. If
          you use it, we (through our authentication provider, Clerk) collect your email address and
          basic account/organization information to identify you and your team, and to manage
          membership and permissions.
        </p>
      </LegalSection>

      <LegalSection title="Game film you upload">
        <p>
          A clip you upload for AI analysis is stored in a private cloud file (Vercel Blob) — it is
          not publicly accessible — and sent to Google&apos;s Gemini AI to detect player routes. That
          detection result is stored as part of your team&apos;s scout script. We do not currently run
          an automatic deletion schedule for uploaded clips; they remain in private storage tied to
          your account. If you want a clip removed, contact us using the details below.
        </p>
        <p>
          <strong className="text-foreground">
            Only upload film you have the right to use, and be mindful that game film of high school
            athletes may include images of minors.
          </strong>{" "}
          You&apos;re responsible for having any consent or authorization your school, league, or
          conference requires before uploading and sharing game film through this service. Don&apos;t
          upload film you&apos;re not authorized to share off-device.
        </p>
      </LegalSection>

      <LegalSection title="Billing information">
        <p>
          Subscriptions are processed by Stripe. We never see or store your full payment card
          details — Stripe collects and handles that directly, under its own privacy policy. We
          store only what&apos;s needed to know your team&apos;s subscription status (active, trialing,
          canceled, etc.) and Stripe&apos;s reference IDs for your account.
        </p>
      </LegalSection>

      <LegalSection title="Who we share data with">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong className="text-foreground">Clerk</strong> — authentication and team/organization
            management.
          </li>
          <li>
            <strong className="text-foreground">Stripe</strong> — subscription billing and payment
            processing.
          </li>
          <li>
            <strong className="text-foreground">Google (Gemini API)</strong> — analyzes uploaded game
            clips to detect player routes, only when you use the AI film import feature.
          </li>
          <li>
            <strong className="text-foreground">Vercel</strong> — hosts the app and stores uploaded
            clips in private cloud storage.
          </li>
        </ul>
        <p>We don&apos;t sell your data, and we don&apos;t share it for advertising purposes.</p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          If you sign in for AI film import, Clerk sets session cookies to keep you signed in. The
          free CSV path sets no cookies and requires no sign-in.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can stop using the AI film feature and its account at any time. To cancel a
          subscription, use the billing portal link in the app (powered by Stripe). To request
          deletion of your account, team data, or uploaded clips, contact us below.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          We may update this policy as the product changes. We&apos;ll update the date at the top of
          this page when we do.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this policy or your data:{" "}
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
