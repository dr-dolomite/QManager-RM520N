"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DUR,
  EASE_QUICK,
  SAVE_CHECK_KEYFRAMES,
  transitionSaveCheck,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

// =============================================================================
// useSaveFlash — brief "Saved!" indicator after a successful save
// =============================================================================
// Usage:
//   const { saved, markSaved } = useSaveFlash();
//   // call markSaved() after a successful save
//
// The timer is owned by a ref and cleared on unmount and on re-trigger. Both
// matter in practice: several callers (e.g. tower-settings) unmount the button
// while the flash is still live, and a caller that saves twice inside the
// window would otherwise have the first timeout cut the second flash short.
// =============================================================================

export function useSaveFlash(duration = 1800) {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const markSaved = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaved(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSaved(false);
    }, duration);
  }, [duration]);

  return { saved, markSaved };
}

// =============================================================================
// SaveButton — the product-wide save action (Motion Guide recipe 15)
// =============================================================================
// Three states cross-fade IN PLACE inside one pill: idle label → spinner +
// "Saving…" → filled check + "Saved!". The check is the single sanctioned
// overshoot in the product (SAVE_CHECK_OVERSHOOT, 1.03).
//
// THE WIDTH LOCK. The guide's requirement is that the button never changes
// width between states, so a toolbar cannot reflow mid-save. The guide's own
// technique — three absolutely-positioned layers over a `min-width` pill — does
// not survive contact with this codebase: absolute children contribute no
// width, so a caller passing `w-fit` collapses the pill to its padding, and no
// single min-width can hold "Update" (6ch), "Lock Selected Bands" (19ch) and
// Italian "Salvataggio…" across five locales without either clipping or leaving
// a cavern on zh-*.
//
// So: a CSS GRID STACK. All three layers sit in the SAME grid cell
// (`[grid-area:1/1]`) of a single-cell inline grid. A grid track sizes itself to
// its widest item, which makes the pill's width max(idle, saving, saved)
// automatically — per locale, with no measurement and no magic number.
//
// The corollary is that all three layers stay PERMANENTLY MOUNTED, with opacity
// alone driving visibility. Hence no `AnimatePresence`: unmounting a layer would
// remove its width contribution and the lock would break on the very frame it
// matters. (It also means a caller that unmounts the whole button mid-flash can
// no longer strand an exit animation.) `overflow-hidden` is gone with it — it
// only ever existed to hide the clipping this design removes.
// =============================================================================

export interface SaveButtonProps extends Omit<ButtonProps, "children"> {
  isSaving: boolean;
  saved: boolean;
  label?: string;
}

/** Opacity-only crossfade between the three layers. Label swaps are `quick`. */
const layerTransition = { duration: DUR.quick, ease: EASE_QUICK } as const;

export function SaveButton({
  isSaving,
  saved,
  label,
  className,
  onClick,
  ...props
}: SaveButtonProps) {
  const { t } = useTranslation("common");
  const resolvedLabel = label ?? t("actions.save_settings");
  const isActive = isSaving || saved;

  // Deliberately NOT `disabled`. A disabled element drops focus to <body> in
  // Chrome and Firefox, so a keyboard user who presses Enter on Save loses their
  // place for the duration of the request. `aria-disabled` announces the same
  // thing without moving focus; the guard below is what actually stops the
  // second activation — including native form submission, since most callers
  // render this as a `type="submit"` inside a <form>.
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isActive) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <Button
      {...props}
      onClick={handleClick}
      aria-disabled={isActive || undefined}
      aria-label={resolvedLabel}
      data-state={isSaving ? "saving" : saved ? "saved" : "idle"}
      className={cn("inline-grid", className)}
    >
      {/* One accessible name on the button itself, stable across all three
          states, so a state change never re-announces the control. The
          announcement channel for the save result is the sonner toast every
          caller already fires — an aria-live here would double-announce. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none flex items-center justify-center gap-1.5 [grid-area:1/1]"
        animate={{ opacity: isActive ? 0 : 1 }}
        transition={layerTransition}
      >
        {resolvedLabel}
      </motion.span>

      <motion.span
        aria-hidden="true"
        className="pointer-events-none flex items-center justify-center gap-1.5 [grid-area:1/1]"
        animate={{ opacity: isSaving ? 1 : 0 }}
        transition={layerTransition}
      >
        <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" />
        {t("actions.saving")}
      </motion.span>

      <motion.span
        aria-hidden="true"
        className="pointer-events-none flex items-center justify-center gap-1.5 [grid-area:1/1]"
        animate={{ opacity: saved ? 1 : 0 }}
        transition={layerTransition}
      >
        <motion.span
          className="flex"
          animate={{ scale: saved ? SAVE_CHECK_KEYFRAMES : 1 }}
          transition={transitionSaveCheck}
        >
          <CheckCircle2Icon className="size-3.5" />
        </motion.span>
        {t("actions.saved")}
      </motion.span>
    </Button>
  );
}
