"use client";

import { MotionConfig } from "motion/react";

import { useMotionPreference } from "@/components/motion-preference";
import { MOTION_ATTRIBUTE } from "@/lib/motion-preference";

// motion elements read reducedMotion once, at mount, so the first render must already be right.
// The pre-paint attribute is the truth; the context subscription only triggers the re-render.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  useMotionPreference();
  const attr =
    typeof document === "undefined"
      ? null
      : document.documentElement.getAttribute(MOTION_ATTRIBUTE);

  return (
    <MotionConfig
      reducedMotion={
        attr === "reduced" ? "always" : attr === "full" ? "never" : "user"
      }
    >
      {children}
    </MotionConfig>
  );
}
