"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadDropzone } from "@/components/UploadDropzone";
import { DEMO_FILE_NAME, MOCK_HUDL_CSV } from "@/lib/demoScript";
import { parseHudlCsvText } from "@/lib/hudlParser";
import { importFilms } from "@/lib/importFilms";
import { saveScript, storeScript } from "@/lib/scriptStore";

/** Landing-page upload: parses on this device, saves the script, opens the cards. */
export function LandingUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const imported = await importFilms(files);
      if (imported.cards.length > 0) {
        storeScript({
          fileName: "",
          films: imported.films,
          savedAt: "",
          cards: imported.cards,
          warnings: imported.warnings,
        });
        router.push("/script?loaded=1");
        return;
      }
      const [first] = imported.failed;
      setError(
        first?.result.unsupportedFile?.message ??
          `No plays found in ${first?.name ?? "that file"}. Export the breakdown from Hudl as a CSV and try again.`,
      );
    } catch {
      setError("Couldn't read those files. Export them from Hudl again and try once more.");
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = () => {
    saveScript(DEMO_FILE_NAME, parseHudlCsvText(MOCK_HUDL_CSV));
    router.push("/script");
  };

  return <UploadDropzone onFiles={handleFiles} onDemo={handleDemo} busy={busy} error={error} />;
}
