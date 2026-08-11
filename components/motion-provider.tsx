"use client";

import { MotionConfig } from "motion/react";

import { useMotionPreference } from "@/components/motion-preference";

// Translates the user's animations choice into MotionConfig's three-valued
// `reducedMotion` prop. The mapping is the whole point of the feature:
//
//   "system"  → "user"   — defer to prefers-reduced-motion. Default.
//   "full"    → "never"  — an explicit choice outranks the OS default.
//   "reduced" → "always" — likewise, in the other direction.
//
// The CSS half of the same choice lives in globals.css, keyed off the
// `data-motion` attribute this provider's parent stamps on <html>.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const { preference } = useMotionPreference();

  return (
    <MotionConfig
      reducedMotion={
        preference === "reduced"
          ? "always"
          : preference === "full"
            ? "never"
            : "user"
      }
    >
      {children}
    </MotionConfig>
  );
}
