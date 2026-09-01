"use client";

import React from "react";
import { motion } from "motion/react";

import { staggerRowItem } from "@/lib/motion";
import { ROW } from "./shapes";

// =============================================================================
// PillRow — one metric row on a tonal pill
// =============================================================================
// Label left, value right, on `ROW.ROOT`. It was declared file-local inside
// `device-metrics.tsx`; it lives here now because step 06 needs the identical
// row for the speed-test result, and a down/up pair rendered two different ways
// on one page is precisely the drift this pass exists to remove. Moved, not
// copied — two definitions would only postpone the divergence.
//
// THE LABEL CELL IS A SLOT, AND THAT IS LOAD-BEARING. `label` is a
// `React.ReactNode`, not a string, because the Data Used row passes a truncating
// text span FOLLOWED BY a ghost icon-button (the counter reset), and the two
// distance rows pass a span plus a tooltip trigger. Step 06 puts a play control
// in the same position. Narrowing this prop to a string would quietly delete
// three controls and block a fourth.
//
// The key cell keeps its shipped `text-sm` spelling rather than moving to
// `ROW.KEY` (13px). Step 00 is the foundation step and changes nothing that
// renders; step 03 re-points the type across every row on the surface at once,
// so the whole surface steps down together rather than one card at a time.
// =============================================================================

export interface PillRowProps {
  /** The label cell. A node, not a string — see the slot note above. */
  label: React.ReactNode;
  /** The value cell(s). Each one is `shrink-0`, so the label truncates first. */
  children: React.ReactNode;
}

export function PillRow({ label, children }: PillRowProps) {
  return (
    <motion.div variants={staggerRowItem} className={ROW.ROOT}>
      {/* Container-Pair Rule: text on `surface-container` takes that
          container's own ink, never a solid role colour. */}
      <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-on-surface-variant">
        {label}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </motion.div>
  );
}

export default PillRow;
