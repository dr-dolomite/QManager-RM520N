"use client";

import { useEffect, useState } from "react";

import { loadApnPresets, matchApnPresets, type ApnPresetMatch } from "@/lib/apn-presets";

// =============================================================================
// useApnPresets: suggested APNs for the SIM in the slot
// =============================================================================
// Loads the bundled preset file once and matches it to the IMSI. `match` is
// null while loading, when the IMSI is missing, when the network has no
// entries, or when the file failed to load: in every case the APN field stays
// a plain input, so there is nothing for the caller to report.
// =============================================================================

export function useApnPresets(imsi: string | null | undefined): ApnPresetMatch | null {
  const [file, setFile] = useState<Awaited<ReturnType<typeof loadApnPresets>> | null>(null);

  useEffect(() => {
    let alive = true;
    loadApnPresets()
      .then((f) => {
        if (alive) setFile(f);
      })
      .catch(() => {
        // Suggestions are optional; the field works without them.
      });
    return () => {
      alive = false;
    };
  }, []);

  return file ? matchApnPresets(file, imsi) : null;
}
