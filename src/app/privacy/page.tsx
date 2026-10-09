import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy — ScoutCard AI",
  description:
    "How ScoutCard AI handles your data: what stays on your device, what the AI features send, and who we share it with.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="October 9, 2026">
      <p>
        This policy explains what ScoutCard AI does and doesn&apos;t do with your data. The short
        version: your Hudl breakdown, your playbook, your playsheet and your edits are read in your
        browser and kept on your device. When you&apos;re signed in, your script, playbook and
        playsheet are also saved to private storage for your coaching team, so every coach on the
        team sees the same thing. The AI features send the little that&apos;s described below.
        Nothing else leaves your device.
      </p>

      <LegalSection title="What's saved, and where">
        <p>
          Uploading a Hudl breakdown (a CSV, an Excel file or pasted rows), uploading your own
          playbook, building a practice playsheet, generating scout cards, editing plays, drawing on
          cards and printing all happen in your browser. Those files are parsed on your device and
          are not uploaded to us or to anyone else.
        </p>
        <p>
          The results are saved in your browser&apos;s local storage on your device: your scout
          script, your playbook, your practice playsheet, your sunlight-mode setting, and a note that
          your sign-in was verified. That&apos;s what lets the app work on a field with no signal.
        </p>
        <p>
          <strong className="text-foreground">Saved for your team.</strong> While you&apos;re signed in,
          your scout script, playbook and practice playsheet (the plays, your edits, notes and
          drawings in them) are also saved to private cloud storage, kept apart for your team.
          Every coach on your team can read and change that shared copy, which is how a second coach,
          or a new iPad, sees the same thing. A coach who isn&apos;t on a team has a copy of their
          own. The copy is replaced each time someone saves and is kept until you ask us to delete
          it. Clearing your browser data does not remove it. The sunlight setting and the
          verified-sign-in note stay on your device only.
        </p>
      </LegalSection>

      <LegalSection title="Signing in">
        <p>
          ScoutCard AI is in a private pilot with coaching staffs, so using the app requires signing
          in. Our authentication provider, Clerk, collects your email address and basic
          account and organization (coaching staff) information to identify you and your team and to
          manage membership. We check your verified sign-in email against the list of invited
          coaches. Once your device has been verified it&apos;s trusted for up to 14 days, so the app
          keeps working on a field with no signal.
        </p>
        <p>The five-play demo on the home page needs no account and sends nothing.</p>
      </LegalSection>

      <LegalSection title="What the AI features send">
        <p>
          The AI features send text, or a clip, to our servers and on to Google&apos;s Gemini API.
          They are only used while you&apos;re signed in. Specifically:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong className="text-foreground">Import review.</strong> After you import a breakdown
            or a playbook, the plays the app couldn&apos;t place on its own (a formation name or
            front it doesn&apos;t know, or a call that isn&apos;t clearly a run or a pass) are sent as
            text: the formation, play call, front and play type for those plays. The rest of your
            file is not sent.
          </li>
          <li>
            <strong className="text-foreground">AI cards.</strong> If you ask the AI to draw a play,
            the play call, formation and defensive call you typed are sent.
          </li>
          <li>
            <strong className="text-foreground">Secondary read from film.</strong> If you read the
            opponent&apos;s secondary from a pre-snap clip, the clip you choose is uploaded, as
            described next.
          </li>
        </ul>
        <p>
          If an AI feature can&apos;t be reached, the app keeps working and draws cards exactly as
          your file reads. AI game-film import, which draws routes from a game clip, is currently
          switched off.
        </p>
      </LegalSection>

      <LegalSection title="Film clips you upload">
        <p>
          A clip you upload for the secondary read is stored in a private cloud file (Vercel Blob),
          which is not publicly accessible, and sent to Google&apos;s Gemini API to read where the
          defensive backs line up. We don&apos;t currently run an automatic deletion schedule for
          uploaded clips; they remain in private storage tied to your account. To have a clip
          removed, contact us using the details below.
        </p>
        <p>
          <strong className="text-foreground">
            Only upload film you have the right to use, and be mindful that game film of high school
            athletes may include images of minors.
          </strong>{" "}
          You&apos;re responsible for any consent or authorization your school, league or conference
          requires before you upload or share film through this service. Don&apos;t upload film
          you&apos;re not authorized to share off your device.
        </p>
      </LegalSection>

      <LegalSection title="Usage counters">
        <p>
          To keep the AI features from being overused, we keep small usage counters: a timestamp and
          a hashed identifier for your team, stored in private cloud storage. They contain none of
          your plays, files or clips.
        </p>
      </LegalSection>

      <LegalSection title="Billing information">
        <p>
          Where your staff has a paid plan, subscriptions are processed by Stripe. We never see or
          store your full payment card details; Stripe collects and handles them directly, under its
          own privacy policy. We store only what&apos;s needed to know your team&apos;s subscription
          status (active, trialing, canceled and so on) and Stripe&apos;s reference IDs for your
          account.
        </p>
      </LegalSection>

      <LegalSection title="Who we share data with">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong className="text-foreground">Clerk</strong> — sign-in and team management.
          </li>
          <li>
            <strong className="text-foreground">Google (Gemini API)</strong> — reads the text and
            clips the AI features send, as described above, under Google&apos;s own terms and
            privacy policy.
          </li>
          <li>
            <strong className="text-foreground">Stripe</strong> — subscription billing and payment
            processing.
          </li>
          <li>
            <strong className="text-foreground">Vercel</strong> — hosts the app and stores your
            team&apos;s shared script, playbook and playsheet, uploaded clips and usage counters in
            private cloud storage.
          </li>
        </ul>
        <p>We don&apos;t sell your data, and we don&apos;t share it for advertising.</p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          Clerk sets session cookies to keep you signed in. The app also uses your browser&apos;s
          local storage for the saved items described above. We don&apos;t use advertising or
          analytics trackers.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          Clearing this site&apos;s data in your browser removes the copy on that device only; your
          team&apos;s shared copy stays until it&apos;s replaced or you ask us to delete it. You can
          stop using the service whenever you like. To cancel a paid subscription, use the billing
          portal in the app (powered by Stripe). To request deletion of your account, your
          team&apos;s shared script, playbook and playsheet, or uploaded clips, contact us below.
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
