"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { AlertTriangle, Film, Lock, MousePointerClick, ScanEye, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isClerkConfigured } from "@/lib/clerkConfig";
import { storeScript } from "@/lib/scriptStore";
import { useTeamAccount } from "@/lib/useTeamAccount";
import { buildCardFromDetection, type DetectedPlay } from "@/lib/videoImport";

const VIDEO_STEPS: { icon: typeof Upload; title: string; detail: string }[] = [
  {
    icon: Upload,
    title: "Upload one play's clip",
    detail:
      "Pick a short clip (10–20 seconds is plenty) of a single play, from a sideline or " +
      "endzone angle. It uploads straight to a private cloud file — never held in the app or " +
      "shown to anyone else.",
  },
  {
    icon: ScanEye,
    title: "AI analyzes the play",
    detail:
      "The AI reviews the clip and tracks each skill player — Q, F, H, X, Y, " +
      "Z — noting where they line up, where their route breaks, and where they end up.",
  },
  {
    icon: Film,
    title: "A card builds instantly",
    detail:
      "The formation, each player's route, and a route tag appear on a scout card right away " +
      "— the exact same card, Print Grid, and storage a CSV-imported play gets.",
  },
  {
    icon: MousePointerClick,
    title: "You correct it by dragging",
    detail:
      "The AI is reading camera angle and depth by eye, not measuring the field — it's a rough " +
      "starting point, not a measurement. Tap and drag any route's break point on the card to " +
      "match what you actually saw on tape.",
  },
];

const CARD_HEADER = (
  <>
    <div className="flex flex-wrap items-center gap-2.5">
      <Badge className="h-6 rounded-full bg-primary px-2.5 text-xs font-extrabold tracking-[0.08em] text-primary-foreground">
        NEW
      </Badge>
      <span className="text-sm font-bold tracking-[0.14em] text-primary">
        NO HUDL BREAKDOWN? USE YOUR GAME FILM
      </span>
    </div>
    <h2 className="font-display text-2xl leading-tight font-extrabold uppercase sm:text-[28px]">
      Turn a game clip into a scout card
    </h2>
  </>
);

interface VideoUploadCardProps {
  /** Skip the NEW badge + heading — for when a wrapping section already introduces the feature. */
  hideHeader?: boolean;
}

/**
 * A paid, per-coaching-staff feature — gated behind Clerk sign-in, an active
 * organization, and a subscription (see src/lib/entitlement.ts). Renders a
 * static "coming soon" version when Clerk isn't configured yet, since this
 * whole component would otherwise call Clerk hooks with no <ClerkProvider>
 * in the tree (see src/app/layout.tsx).
 */
export function VideoUploadCard({ hideHeader }: VideoUploadCardProps) {
  if (!isClerkConfigured()) {
    return (
      <Card className="gap-3 rounded-2xl border-2 border-primary/70 bg-primary/[0.07] py-5">
        <CardContent className="flex flex-col gap-3 px-5">
          {!hideHeader && CARD_HEADER}
          <Button size="lg" className="w-fit" disabled>
            <Film aria-hidden="true" />
            AI film import coming soon
          </Button>
          <p className="max-w-[540px] text-sm text-muted-foreground">
            A paid feature for your coaching staff, not set up on this deployment yet. The CSV
            importer above stays free with no sign-in, always.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <VideoUploadCardInner hideHeader={hideHeader} />;
}

function VideoUploadCardInner({ hideHeader }: VideoUploadCardProps) {
  const router = useRouter();
  const clerk = useClerk();
  const account = useTeamAccount();
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);

  const handleSubscribe = async () => {
    setVideoBusy(true);
    setVideoError(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const payload = await res.json();
      if (!res.ok || !payload.url) {
        setVideoError(payload.error ?? "Couldn't start checkout.");
        setVideoBusy(false);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setVideoError("Couldn't start checkout. Try again.");
      setVideoBusy(false);
    }
  };

  const handleUploadClick = () => {
    if (account.loading) return;
    if (!account.userId) {
      clerk.openSignIn();
      return;
    }
    if (!account.team) {
      clerk.openCreateOrganization();
      return;
    }
    if (!account.entitled) {
      void handleSubscribe();
      return;
    }
    videoInput.current?.click();
  };

  const uploadButtonLabel = account.loading
    ? "Loading…"
    : videoBusy
      ? !account.userId || !account.team
        ? "Working…"
        : !account.entitled
          ? "Redirecting to checkout…"
          : "Reading the clip…"
      : !account.userId
        ? "Sign in to upload film"
        : !account.team
          ? "Create a team to continue"
          : !account.entitled
            ? "Subscribe to unlock AI film import"
            : "Upload game film";

  /**
   * Upload a game clip straight to blob storage, send its URL to
   * `/api/parse-video` for AI route detection, and build a card from what
   * comes back. This is a rough, unverified detection meant to be corrected
   * on the card afterward — see `coordinateMapper.ts`'s doc comment.
   */
  const handleVideoFile = async (file: File) => {
    setVideoBusy(true);
    setVideoError(null);
    try {
      const { upload } = await import("@vercel/blob/client");
      // Private: opposing-team film shouldn't sit at a plain fetchable URL.
      // /api/parse-video authenticates when it fetches this server-side.
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/blob-upload",
      });

      const res = await fetch("/api/parse-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: blob.url, fileName: file.name }),
      });
      const payload = (await res.json()) as { detection?: DetectedPlay; fileName?: string; error?: string };
      if (!res.ok || !payload.detection) {
        setVideoError(payload.error ?? "The vision model couldn't read this clip.");
        return;
      }

      const card = buildCardFromDetection(payload.detection, payload.fileName ?? file.name);
      storeScript({
        fileName: "",
        films: [payload.fileName ?? file.name],
        savedAt: "",
        cards: [card],
        warnings: [
          "AI-detected routes are a rough starting point — drag each route's break points on " +
            "the card to correct them.",
        ],
      });
      router.push("/script?loaded=1");
    } catch {
      setVideoError("Couldn't process that clip. Try again, or use a shorter one.");
    } finally {
      setVideoBusy(false);
    }
  };

  return (
    <>
      <Card className="gap-3 rounded-2xl border-2 border-primary/70 bg-primary/[0.07] py-5">
        <CardContent className="flex flex-col gap-3 px-5">
          {!hideHeader && CARD_HEADER}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              size="lg"
              className="w-fit"
              disabled={videoBusy || account.loading}
              onClick={handleUploadClick}
            >
              <Film aria-hidden="true" />
              {uploadButtonLabel}
            </Button>
            <button
              type="button"
              onClick={() => setHowItWorksOpen(true)}
              className="text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              How does this work?
            </button>
          </div>
          <p className="max-w-[540px] text-sm text-muted-foreground">
            AI-detected routes are a rough first pass — this clip is sent to a vision model for
            analysis, unlike the CSV above. You&apos;ll drag each route into shape on the card.
            A paid feature for your coaching staff: sign in, create or join your staff&apos;s
            team, and subscribe once to unlock it for everyone on the team.
          </p>
          {videoError && <p className="text-sm font-semibold text-destructive">{videoError}</p>}
          <input
            ref={videoInput}
            type="file"
            accept="video/mp4,video/quicktime,video/x-m4v"
            className="sr-only"
            aria-label="Upload a game clip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleVideoFile(file);
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl font-bold">
              How AI video import works
            </DialogTitle>
            <DialogDescription className="text-base">
              Four steps from a game clip to a card you can adjust and print.
            </DialogDescription>
          </DialogHeader>

          <ol className="flex flex-col gap-4">
            {VIDEO_STEPS.map(({ icon: Icon, title, detail }, i) => (
              <li key={title} className="flex gap-3.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-primary text-primary"
                  aria-hidden="true"
                >
                  <Icon className="size-[18px]" />
                </span>
                <div className="flex flex-col gap-0.5 pt-1">
                  <span className="font-display text-lg leading-none font-extrabold uppercase">
                    {String(i + 1)}. {title}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
                </div>
              </li>
            ))}
          </ol>

          <p className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            Unlike the CSV importer above, your clip does leave the device — it&apos;s sent to an
            AI service for analysis. Don&apos;t upload film you&apos;re not allowed to share
            off-device.
          </p>
          <p className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm leading-relaxed">
            <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            This is a paid feature, billed per coaching staff. Sign in, create (or join) your
            staff&apos;s team, and subscribe once — every coach on that team then gets AI film
            import. The CSV importer above stays free with no sign-in, always.
          </p>

          <DialogFooter>
            <Button size="lg" onClick={() => setHowItWorksOpen(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
