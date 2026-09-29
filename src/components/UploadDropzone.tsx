"use client";

import { useRef, useState } from "react";
import { ClipboardPaste, FileText, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  /** One or more Hudl CSVs or Excel workbooks (one per film). */
  onFiles: (files: File[]) => void;
  onDemo: () => void;
  /** Pasted clipboard text (e.g. copied straight out of Excel or Google Sheets). */
  onPasteText: (text: string) => void;
  busy?: boolean;
  error?: string | null;
}

function isBreakdownFile(file: File): boolean {
  return /\.(csv|xlsx)$/i.test(file.name) || file.type === "text/csv";
}

export function UploadDropzone({ onFiles, onDemo, onPasteText, busy, error }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  const accept = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const usable = files.filter(isBreakdownFile);
    const skipped = files.filter((f) => !isBreakdownFile(f)).map((f) => `"${f.name}"`);
    if (usable.length === 0) {
      setLocalError(`${skipped.join(", ")} isn't a .csv or .xlsx file. Export the breakdown as one of those.`);
      return;
    }
    setLocalError(skipped.length ? `Skipped ${skipped.join(", ")}: not a .csv or .xlsx file.` : null);
    onFiles(usable);
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
            <p className="text-xl font-bold sm:text-[22px]">Drop your Hudl .csv or .xlsx exports here</p>
            <p className="text-[15px] text-muted-foreground">
              One file per film. Add as many games as you want in one script.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="xl" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileText aria-hidden="true" />
            {busy ? "Reading files…" : "Choose files"}
          </Button>
          <Button size="xl" variant="outline" onClick={onDemo} disabled={busy}>
            <Play aria-hidden="true" className="fill-current" />
            Load demo script · 5 plays
          </Button>
          <Button size="xl" variant="outline" onClick={() => setPasting((p) => !p)} disabled={busy}>
            <ClipboardPaste aria-hidden="true" />
            {pasting ? "Cancel paste" : "Paste breakdown"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv"
            multiple
            className="sr-only"
            aria-label="Hudl breakdown files"
            onChange={(e) => {
              accept(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {pasting && (
          <textarea
            autoFocus
            placeholder="Click here, then paste (Ctrl+V / Cmd+V) a breakdown copied from Excel or Google Sheets…"
            className="min-h-28 w-full resize-y rounded-xl border-2 border-input bg-background p-3 text-sm outline-none focus:border-primary"
            disabled={busy}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.trim()) return;
              e.preventDefault();
              setPasting(false);
              onPasteText(text);
            }}
            onChange={() => {
              // Paste is handled on the paste event itself; typing here does nothing.
            }}
          />
        )}
      </div>
      {message && (
        <p role="alert" className="text-[15px] font-semibold text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
