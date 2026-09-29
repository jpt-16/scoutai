"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-shown={shown}
      className={cn("reveal", className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
  align = "center",
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("flex flex-col gap-4", align === "center" ? "mx-auto max-w-2xl items-center text-center" : "")}>
      <p className="text-[13px] font-bold tracking-[0.2em] text-primary">{eyebrow}</p>
      <h2 className="font-display text-[40px] leading-[0.95] font-extrabold text-balance uppercase sm:text-5xl lg:text-[56px]">
        {title}
      </h2>
      {children && <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">{children}</p>}
    </div>
  );
}

/** The one primary CTA, identical everywhere it appears. */
export function TryCta({
  className,
  label = "Try ScoutCard AI",
  compact,
}: {
  className?: string;
  label?: string;
  compact?: boolean;
}) {
  return (
    <Button
      size="xl"
      asChild
      className={cn(
        "group rounded-xl shadow-[0_10px_40px_-10px] shadow-primary/60 transition-all hover:-translate-y-0.5 hover:bg-primary hover:shadow-[0_16px_50px_-10px] hover:shadow-primary/70",
        compact ? "h-10 px-4 text-[15px] has-[>svg]:px-4" : "h-14 px-7 text-lg",
        className,
      )}
    >
      <a href="#upload">
        {label}
        <ArrowRight className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </a>
    </Button>
  );
}
