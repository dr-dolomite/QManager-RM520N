"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { useDeviceHostname } from "@/hooks/use-device-hostname";
import { Skeleton } from "@/components/ui/skeleton";
import { DUR, EASE_QUICK } from "@/lib/motion";

// =============================================================================
// LoginDeviceName — pre-auth device-identity line
// =============================================================================
// Answers "which modem am I signing into?". Self-contained by design: it owns
// the hostname fetch and all three states, so a caller only has to drop it in.
//
// TWO VARIANTS, because two surfaces mount this and they are not asking the
// same question:
//
//   "signin"    (default) — the standalone line, "Sign in as sdxlemur". This is
//                the shipped behaviour and the OVERVIEW SPLASH still uses it
//                (components/public/overview-card.tsx). Unchanged.
//   "sentence"  — /login only. The device name is folded INTO the instruction:
//                "Enter your password to manage sdxlemur." That answers which
//                modem in the same breath as what to do, rather than spending a
//                second muted line on it.
//
// The variant is opt-in rather than a straight replacement on purpose. The
// sentence form is a password instruction, and the Overview splash has no
// password field on it — retargeting the default would have put "Enter your
// password to manage…" on a read-only status card. If the Overview wants a
// third form (its own mock draws a bare "sdxlemur" under the heading), that is
// a new variant, not a redefinition of this one.
//
// SILENT OMISSION, both variants, is the load-bearing contract: older firmware
// without the CGI, or a device with no name set, yields `null` from the hook.
//   - "signin" renders nothing and the title block closes up.
//   - "sentence" falls back to the bare instruction, "Enter your password."
// Neither ever renders a placeholder. A fake device name on a login screen is a
// lie about which modem you are about to configure.
//
// Type identity, not the AT terminal: per DESIGN.md's Machine-Voice Rule the
// hostname renders in the UI typeface, not mono. Mono is scoped to the AT
// terminal and raw AT output; a device name on the login screen is not that.
// In the sentence form it is set apart by WEIGHT and INK (semibold, foreground)
// against the muted prose around it — which is the same distinction the mock
// draws, achieved without a second typeface.
// =============================================================================

interface LoginDeviceNameProps {
  variant?: "signin" | "sentence";
}

export function LoginDeviceName({
  variant = "signin",
}: LoginDeviceNameProps = {}) {
  const { t } = useTranslation("common");
  const { hostname, isLoading } = useDeviceHostname();
  const shouldReduceMotion = useReducedMotion();

  const isSentence = variant === "sentence";

  // Tokenized from lib/motion.ts so the skeleton↔name swap settles on the same
  // curve and cadence as the rest of the product. This is a label swap, which
  // the motion canon puts on `quick`: the line is resolving a value, not making
  // an entrance, and a longer settle would draw the eye to a detail that does
  // not deserve it.
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: DUR.quick, ease: EASE_QUICK };

  const textClass = isSentence
    ? "text-on-surface-variant min-w-0 max-w-full text-sm leading-relaxed"
    : "text-muted-foreground min-w-0 max-w-full truncate text-sm font-medium tracking-tight";

  return (
    // mode="wait" so the skeleton fades fully out before the resolved line fades
    // in — no cross-fade overlap, and the absent case reflows the column
    // gracefully instead of the line vanishing mid-frame.
    <AnimatePresence mode="wait" initial={false}>
      {isLoading ? (
        <motion.div
          key="loading"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          // Reserves the same line-box the resolved text occupies so the
          // skeleton→text swap lands on the same baseline with no vertical jump.
          className={
            isSentence ? "flex h-5 justify-center" : "flex h-5 items-center"
          }
        >
          {/* The sentence form resolves to a full instruction, so its skeleton
              is a sentence-width bar. A 144px bar under a 24px headline would
              understate the incoming line and the block would jump wider when
              the hostname landed. */}
          <Skeleton
            className={isSentence ? "h-3.5 w-56 rounded" : "h-3.5 w-36 rounded"}
          />
        </motion.div>
      ) : hostname ? (
        <motion.p
          key="hostname"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className={textClass}
        >
          {/* Screen readers get one clean sentence; the visible copy is hidden
              from the a11y tree so the hostname isn't announced twice, and so
              the styled-substring markup never reaches a screen reader as a
              fragmented phrase. */}
          <span className="sr-only">
            {t("login.signing_in_to", { hostname })}
          </span>
          <span aria-hidden>
            {isSentence
              ? withSlot(
                  t("login.password_to_manage", { hostname: SLOT }),
                  <span className="text-foreground font-semibold">
                    {hostname}
                  </span>,
                )
              : t("login.signing_in_as", { hostname })}
          </span>
        </motion.p>
      ) : isSentence ? (
        // No hostname: the instruction still stands on its own. This is the one
        // case where the sentence variant renders where "signin" would not —
        // "Enter your password." is not a claim about the device, so there is
        // nothing to omit.
        <motion.p
          key="bare"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className={textClass}
        >
          {t("login.password_to_manage_bare")}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
