"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppGate } from "@/components/AppGate";
import { BrandMark } from "@/components/BrandMark";
import { FilmLibrary } from "@/components/FilmLibrary";
import { Button } from "@/components/ui/button";

/** Game film: upload a game's clips and open the scout cards the film analyzer builds from them. */
export default function FilmPage() {
  return (
    <AppGate>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button asChild variant="outline" size="icon" className="border">
            <Link href="/" aria-label="Back to the home page">
              <ChevronLeft className="size-5" />
            </Link>
          </Button>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-bold tracking-[0.14em] text-primary">GAME FILM</span>
            <span className="font-display truncate text-2xl leading-[1.05] font-bold">Film in. Scout cards out.</span>
          </div>
          <div className="hidden sm:block">
            <BrandMark />
          </div>
        </header>
        <FilmLibrary />
      </div>
    </AppGate>
  );
}
