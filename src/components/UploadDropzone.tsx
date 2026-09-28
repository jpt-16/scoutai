"use client";

import { useRef, useState } from "react";
import { FileText, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-3">
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
          "flex flex-col gap-5 rounded-2xl border-2 border-dashed bg-card p-6 transition-colors sm:p-7",
          dragging ? "border-primary bg-muted" : "border-input",
        )}
      >
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Upload className="size-7 text-primary" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xl font-bold sm:text-[22px]">Drop your Hudl .csv exports here</p>
            <p className="text-[15px] text-muted-foreground">
              One file per film. Add as many games as you want in one script.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="xl" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileText aria-hidden="true" />
            {busy ? "Reading files…" : "Choose CSV files"}
          </Button>
          <Button size="xl" variant="outline" onClick={onDemo} disabled={busy}>
            <Play aria-hidden="true" className="fill-current" />
            Load demo script · 5 plays
          </Button>
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
      </div>
      {message && (
        <p role="alert" className="text-[15px] font-semibold text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
