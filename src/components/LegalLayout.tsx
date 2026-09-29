import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

/**
 * Shared shell for /privacy and /terms — minimal chrome (brand mark, back
 * link, footer) matching the landing page, with content styled by hand
 * (no @tailwindcss/typography plugin installed) rather than a `prose` class.
 */
export function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b bg-background/95 px-6 backdrop-blur lg:px-12">
        <Link href="/" className="shrink-0">
          <BrandMark />
        </Link>
        <Link href="/" className="text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          Back to home
        </Link>
      </header>

      <main className="flex-1 px-6 py-14 lg:px-12">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-4xl leading-tight font-extrabold uppercase sm:text-5xl">{title}</h1>
            <p className="text-sm font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Last updated {lastUpdated}
            </p>
          </div>
          <div className="flex flex-col gap-8 text-[17px] leading-relaxed text-[#c9cfc9]">{children}</div>
        </div>
      </main>

      <footer className="border-t px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 sm:flex-row">
          <BrandMark />
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A section heading + body, the repeated shape both legal pages are built from. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-extrabold uppercase text-foreground">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
