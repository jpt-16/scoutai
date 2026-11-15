"use client";

import { useRef, useState } from "react";
import { FileUp, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  /** One or more Hudl CSVs (one per film). */
  onFiles: (files: File[]) => void;
  onDemo: () => void;
  busy?: boolean;
  error?: string | null;
}

function isCsv(file: File): boolean {
  return /\.csv$/i.test(file.name) || file.type === "text/csv";
}

export function UploadDropzone({ onFiles, onDemo, busy, error }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const csvs = files.filter(isCsv);
    const skipped = files.filter((f) => !isCsv(f)).map((f) => `"${f.name}"`);
    if (csvs.length === 0) {
      setLocalError(`${skipped.join(", ")} isn't a .csv file. Export the breakdown as CSV.`);
      return;
    }
    setLocalError(skipped.length ? `Skipped ${skipped.join(", ")}: not a .csv file.` : null);
    onFiles(csvs);
  };

  const message = localError ?? error;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-5 rounded-[28px] border border-white/10 bg-white/[0.04] px-6 py-8 text-center transition-[background-color,border-color,transform] duration-200 ease-out motion-reduce:transition-none sm:px-10",
          dragging && "scale-[1.015] border-primary/70 bg-primary/10 motion-reduce:scale-100",
        )}
      >
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15">
          <FileUp className="size-7 text-primary" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">
            {dragging ? "Release to import" : "Drop your Hudl CSV here"}
          </p>
          <p className="text-[15px] leading-snug text-muted-foreground">
            One file per film. Add as many games as you like.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex h-[52px] w-full items-center justify-center rounded-full bg-primary px-8 text-[17px] font-semibold text-primary-foreground transition-[transform,opacity] duration-100 ease-out outline-none select-none hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60 motion-reduce:active:scale-100 sm:w-auto"
        >
          {busy ? "Reading files…" : "Choose CSV files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          aria-label="Hudl CSV files"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <button
        type="button"
        onClick={onDemo}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[17px] font-medium text-primary transition-[transform,opacity] duration-100 ease-out outline-none hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/60 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100"
      >
        <Play className="size-4 fill-current" aria-hidden="true" />
        Try the demo · 5 plays
      </button>

      {message && (
        <p role="alert" className="text-center text-[15px] font-semibold text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
