"use client";

import { useRef, useState } from "react";
import { FileText, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  onFile: (file: File) => void;
  onDemo: () => void;
  busy?: boolean;
  error?: string | null;
}

function isCsv(file: File): boolean {
  return /\.csv$/i.test(file.name) || file.type === "text/csv";
}

export function UploadDropzone({ onFile, onDemo, busy, error }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!isCsv(file)) {
      setLocalError(`"${file.name}" isn't a .csv file. In Hudl, export the breakdown as CSV.`);
      return;
    }
    setLocalError(null);
    onFile(file);
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
          accept(e.dataTransfer.files[0]);
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
            <p className="text-xl font-bold sm:text-[22px]">Drop your Hudl .csv export here</p>
            <p className="text-[15px] text-muted-foreground">
              Reads PLAY #, DN, DIST, HASH, YARD LN, OFF FORM, OFF PLAY, DEF FRONT
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="xl" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileText aria-hidden="true" />
            {busy ? "Reading file…" : "Choose CSV file"}
          </Button>
          <Button size="xl" variant="outline" onClick={onDemo} disabled={busy}>
            <Play aria-hidden="true" className="fill-current" />
            Load demo script · 5 plays
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Hudl CSV file"
            onChange={(e) => {
              accept(e.target.files?.[0]);
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
