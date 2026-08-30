"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import { BODY, CARD_TITLE, EYEBROW } from "@/components/pre-auth-type";
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
//   "signin"  (default) — the standalone line, "Sign in as sdxlemur". This is
//              the shipped behaviour and the OVERVIEW SPLASH still uses it
//              (components/public/overview-card.tsx). Its ANATOMY is unchanged;
//              only its type and ink moved onto the shared pre-auth module.
//   "title"   — /login only. The device name IS the card's h1, under a quiet
//              "Sign in to" eyebrow.
//
// WHY "title" EXISTS, and why it is an addition rather than a redefinition.
// The previous file's own comment anticipated it: "If the Overview wants a
// third form ... that is a new variant, not a redefinition of this one." The
// same reasoning applies in the other direction. /login/ used to GREET, then
// ask — spending its loudest step and its only colour on the constant string
// "Welcome to QManager", and one muted 14px line, folded mid-sentence, on the
// hostname. The hostname is the only fact on that screen that varies, and this
// component's whole job is to report it, so the composition was giving its own
// answer the least weight on the card. Now the card IDENTIFIES, then asks.
//
// The retired "sentence" form ("Enter your password to manage sdxlemur.") went
// with that inversion: once the hostname is the h1, folding it into the
// password instruction would state the same fact twice on a card that holds
// three text elements. Its two keys — `login.password_to_manage` and
// `password_to_manage_bare` — are KEPT in all five locales, per this repo's
// practice of not breaking installed language packs.
//
// SILENT OMISSION, both variants, is the load-bearing contract: older firmware
// without the CGI, or a device with no name set, yields `null` from the hook.
//   - "signin" renders nothing and the block closes up.
//   - "title" drops the eyebrow entirely and falls back to `login.welcome`,
//     an existing translated key — so the h1 slot is never empty and never a
//     guess.
// Neither ever renders a placeholder. A fake device name on a login screen is a
// lie about which modem you are about to configure.
//
// The eyebrow is also what retires the `signing_in_as` / `signing_in_to`
// disagreement STRUCTURALLY rather than by picking a word: the visible copy now
// reads "Sign in to / sdxlemur" and the sr-only line reads "Signing in to
// sdxlemur". They finally agree.
//
// Type identity, not the AT terminal: per DESIGN.md's Machine-Voice Rule the
// hostname renders in the UI typeface, not mono. Mono is scoped to the AT
// terminal and raw AT output; a device name on the login screen is not that.
// Every step here is IMPORTED from components/pre-auth-type.ts — the two
// pre-auth cards are the same object seen twice, and restating a step is how
// they silently re-fork.
// =============================================================================

/**
 * The resolved title's line box: 19px on a 1.15 leading. Stated once, so the
 * skeleton reserves exactly what the text will occupy rather than mirroring it
 * by a hand-copied number that drifts the next time CARD_TITLE moves.
 */
const TITLE_LINE_BOX = "h-[1.365625rem]";

interface LoginDeviceNameProps {
  variant?: "signin" | "title";
}

export function LoginDeviceName({
  variant = "signin",
}: LoginDeviceNameProps = {}) {
  const { t } = useTranslation("common");
  const { hostname, isLoading } = useDeviceHostname();
  const shouldReduceMotion = useReducedMotion();

  const isTitle = variant === "title";

  // Tokenized from lib/motion.ts so the skeleton↔name swap settles on the same
  // curve and cadence as the rest of the product. This is a label swap, which
  // the motion canon puts on `quick`: the line is resolving a value, not making
  // an entrance, and a longer settle would draw the eye to a detail that does
  // not deserve it.
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: DUR.quick, ease: EASE_QUICK };

  const enter = shouldReduceMotion ? false : { opacity: 0, y: 4 };

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
          // Reserves the line box the resolved text occupies so the
          // skeleton→text swap lands on the same baseline with no vertical jump.
          // The title form reserves the 19px h1 box, NOT the eyebrow above it:
          // whether an eyebrow is coming depends on whether a hostname exists,
          // which is precisely what has not resolved yet. Reserving for the
          // taller outcome would leave a gap on every nameless device.
          className={
            isTitle
              ? `flex ${TITLE_LINE_BOX} items-center justify-center`
              : "flex h-5 items-center"
          }
        >
          {/* `rounded`, not one of this repo's custom radii: cn() is bare
              tailwind-merge and cannot dedupe `rounded-card`/`field`/`inline`
              against Skeleton's own default, so a custom name here would lose
              silently. A skeleton bar wants the plain radius anyway. */}
          <Skeleton className={isTitle ? "h-4 w-40 rounded" : "h-3.5 w-36 rounded"} />
        </motion.div>
      ) : isTitle ? (
        <motion.div
          key="title"
          initial={enter}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="flex min-w-0 max-w-full flex-col items-center gap-[5px]"
        >
          {/* The eyebrow is decorative to a screen reader: it is one half of a
              sentence whose other half is the h1, and announced on its own it
              would arrive as a disconnected fragment before the name it
              introduces. The h1 below carries the whole sentence instead. */}
          {hostname ? (
            <span aria-hidden className={`${EYEBROW} text-on-surface-variant`}>
              {t("login.sign_in_to_label")}
            </span>
          ) : null}
          {/* The h1 STAYS in the a11y tree — it is this page's only heading, and
              hiding it to avoid a double announcement would leave the login
              screen with no heading to navigate to. So the sentence lives
              inside it as sr-only text and the visible name is the aria-hidden
              layer: one heading, announced once, as "Signing in to sdxlemur". */}
          <h1 className={`${CARD_TITLE} min-w-0 max-w-full truncate`}>
            {hostname ? (
              <>
                <span className="sr-only">
                  {t("login.signing_in_to", { hostname })}
                </span>
                <span aria-hidden className="block truncate">
                  {hostname}
                </span>
              </>
            ) : (
              t("login.welcome")
            )}
          </h1>
        </motion.div>
      ) : hostname ? (
        <motion.p
          key="hostname"
          initial={enter}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className={`${BODY} text-on-surface-variant min-w-0 max-w-full truncate font-medium tracking-tight`}
        >
          <span className="sr-only">
            {t("login.signing_in_to", { hostname })}
          </span>
          <span aria-hidden>{t("login.signing_in_as", { hostname })}</span>
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
