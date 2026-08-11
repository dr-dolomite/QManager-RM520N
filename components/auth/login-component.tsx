"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";

import { useLogin } from "@/hooks/use-auth";
import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { LoginDeviceName } from "@/components/auth/login-device-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Spinner } from "@/components/ui/spinner";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { DUR, EASE_STANDARD, STAGGER_STEP, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

// =============================================================================
// LoginComponent — the pre-auth surface, in the tonal system
// =============================================================================
// One card on an empty canvas, which makes it the screen where a container-based
// system either feels considered or feels sparse. Anatomy is unchanged from the
// version this replaces (mark → title → device line → password → submit); what
// changed is that every piece now sits in a token the rest of the product also
// speaks.
//
// Four decisions worth keeping:
//
//   1. ICONS ARE MATERIAL HERE. The Icon-Boundary Rule used to scope Material
//      Symbols to the sidebar and /dashboard; the product owner extended it to
//      cover `/` and `/login/`. Both pre-auth routes are now Material end to
//      end. `size` is mandatory at every call site — MaterialSymbol writes an
//      inline fontSize, which outranks any `size-*` utility.
//
//   2. THE LOCKOUT IS AMBER, NOT RED. Rate limiting is degraded-but-recoverable
//      and self-clearing: the device is protecting itself, and waiting fixes it.
//      Destructive is reserved for the attempt that actually failed — the inline
//      error under the field. Two tones, two different meanings, and the glyph
//      (`lock_clock` vs a filled `error`) separates them without relying on hue,
//      which matters because warning-container and its neighbours measure ~1:1
//      apart under deuteranopia.
//
//   3. THE SUBMIT BUTTON NEVER RESIZES. Its three labels are stacked in one
//      grid cell and cross-faded, so idle → submitting → locked is a pure
//      opacity change. The previous implementation swapped three strings of
//      three different widths inside an auto-width button; on a full-width
//      button the box held, but the label still jumped. Motion Guide recipe 15
//      forbids the reflow, and the countdown digits ride in tabular-nums so the
//      sentence does not twitch once a second either.
//
//   4. EVERY STRING IS KEYED. `common:login.*` has been fully translated in all
//      five locales for some time; this component simply never called `t()`. A
//      device in the field was rendering English regardless of the user's
//      language pick.
// =============================================================================

/**
 * The countdown as a tabular figure. Both the banner and the button render
 * the same formatted value through the same treatment, so a user reading one
 * and then the other is never asked to reconcile two differently-shaped clocks.
 */
function tabularCount(value: string) {
  return <span className="font-semibold tabular-nums">{value}</span>;
}

/**
 * `28s` under a minute, `4:32` above it. The lockout ladder reaches 900s, so
 * minutes are genuinely reachable and a bare `847s` would be a number the
 * reader has to do arithmetic on.
 */
function formatLockout(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Card entrance (Motion Guide recipe 01) composed with the content cascade
 * (recipe 02). One element carries both: the card rises 10px on the standard
 * curve while its groups settle in sequence a `STAGGER_STEP` apart.
 *
 * Built from the shared tokens rather than literals — the previous version used
 * `y: 12` with `ease: "easeOut"`, a duration and a curve the system does not
 * produce together, so the one screen every user sees first was also the one
 * screen that did not move like the product.
 */
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DUR.standard,
      ease: EASE_STANDARD,
      staggerChildren: STAGGER_STEP,
    },
  },
};

type InlineError =
  | { kind: "invalid"; attemptsRemaining?: number }
  | { kind: "generic"; message: string }
  | null;

export default function LoginComponent() {
  const { t } = useTranslation("common");
  const { status, login, lockout } = useLogin();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<InlineError>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  const wasOffline =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("reason") === "offline";

  // Redirect to the dedicated onboarding wizard when this is a fresh install.
  useEffect(() => {
    if (status === "setup_required") {
      window.location.href = "/setup/";
    }
  }, [status]);

  // Seed the countdown from the server. The lockout lives in the backend's rate
  // limiter, not in this component — so a page refresh mid-lockout used to
  // present an enabled button that could only fail, which reads as the device
  // being broken rather than as it protecting itself. `check.sh` reports the
  // remaining time on mount and `useLogin` surfaces it here.
  useEffect(() => {
    if (lockout?.active && lockout.retryAfter > 0) {
      setRetryAfter((prev) => Math.max(prev, lockout.retryAfter));
    }
  }, [lockout?.active, lockout?.retryAfter]);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => {
      setRetryAfter((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try {
        const result = await login(password);
        if (result.success) return;

        // Branch on the sentinel, never on the truthiness of `retry_after`.
        // A lockout that has just under a second left reports `retry_after: 0`,
        // and `if (result.retry_after)` silently demoted that to a generic
        // error — the one case where the user most needs to be told to wait.
        if (result.error === "rate_limited") {
          setRetryAfter(Math.max(0, result.retry_after ?? 0));
          // The banner carries the whole message; a second red line under the
          // field would be the same news told twice in two different tones.
          setError(null);
        } else if (result.error === "invalid_password") {
          setError({
            kind: "invalid",
            attemptsRemaining: result.attempts_remaining,
          });
        } else {
          setError({
            kind: "generic",
            message: result.detail || t("login.invalid_password"),
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [password, login, t],
  );

  // Detecting setup status, or already on the way to /setup/. Deliberately not
  // a skeleton of the card: this resolves in one CGI round-trip on localhost, so
  // a full card outline would flash and be gone before it could be read.
  if (status === "loading" || status === "setup_required") {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  const isLocked = retryAfter > 0;
  const lockoutLabel = formatLockout(retryAfter);
  const hasNotice = wasOffline || isLocked || error !== null;

  // `attempts_remaining: 0` on an UNLOCKED form is a real, reachable state, not
  // a bug: once a user is on the rate-limit ladder, `remaining` is
  // MAX_ATTEMPTS - count, and `count` stays at 5+ after a lockout expires until
  // a successful login or the 1h decay. So the form is usable, but the next
  // wrong password re-locks with no free attempt.
  //
  // Rendering that through the plural gives "0 attempts left", which is both
  // awkward and false in the direction that matters — it says you cannot try
  // when you can, once. The count is dropped and the plain sentence stands.
  // Deliberately NOT a new "your next attempt will lock you out" string: that
  // is a sixth key needing five translations for an edge state, and the honest
  // short sentence costs the user nothing.
  const errorMessage =
    error === null
      ? null
      : error.kind === "generic"
        ? error.message
        : typeof error.attemptsRemaining === "number" &&
            error.attemptsRemaining > 0
          ? t("login.attempts_left", { count: error.attemptsRemaining })
          : t("login.invalid_password");

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        "bg-card rounded-hero flex w-full max-w-[404px] flex-col px-[34px] py-9 shadow-[var(--shadow-whisper)]",
        // The card breathes at 24px when it is only saying "sign in", and closes
        // to 20px once it is also carrying a notice — so an extra block of
        // content does not push the button off a short screen.
        hasNotice ? "gap-5" : "gap-6",
      )}
    >
      {/* Notices are direct children WITHOUT a stagger variant: they own
          `.animate-banner-in` (recipe 04), and a second transform on a wrapper
          would compound into a rise the guide does not describe. */}
      {wasOffline && !isLocked ? (
        <TonalBanner
          tone="warning"
          icon="wifi_off"
          title={t("login.session_expired_title")}
        >
          {t("login.session_expired")}
        </TonalBanner>
      ) : null}

      {isLocked ? (
        <TonalBanner
          tone="warning"
          icon="lock_clock"
          title={t("login.locked_title")}
        >
          {withSlot(
            t("login.locked_body", { seconds: SLOT }),
            tabularCount(lockoutLabel),
          )}
        </TonalBanner>
      ) : null}

      <motion.div
        variants={staggerItem}
        className="flex flex-col items-center gap-3 text-center"
      >
        {/* The mark in the brand's own tonal disc. It is the first colour on the
            first screen, and the one place in the product where pure brand
            expression costs nothing operationally. `alt=""` because the heading
            directly beneath already names the product. */}
        <div className="bg-primary-container grid size-[76px] place-items-center rounded-full p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/qmanager-mark.svg"
            alt=""
            className="size-full object-contain"
          />
        </div>
        <div className="flex min-w-0 max-w-full flex-col gap-[5px]">
          <h1 className="text-2xl leading-[1.15] font-semibold tracking-[-0.015em]">
            {t("login.welcome")}
          </h1>
          {/* Silent-omission contract: with no hostname this renders nothing and
              the block closes up. Do not substitute a placeholder — a fake
              device name on a login screen is a lie about which modem you are
              about to configure. */}
          <LoginDeviceName variant="sentence" />
        </div>
      </motion.div>

      <form onSubmit={handleSubmit} className="contents">
        <motion.div
          variants={staggerItem}
          className={cn(
            "flex flex-col gap-2",
            // The whole group recedes while locked — label, field and eye
            // together — so it reads as one temporarily-unavailable object
            // rather than three separately greyed controls.
            isLocked && "pointer-events-none opacity-50",
          )}
        >
          {/* The pre-auth card's 13px body step, not the 12px Label step: this
              label sits above a 48px field on a screen with three text elements
              total, and 12px under a 24px headline reads as fine print.
              13px here is NOT the dense-metric-row step (which is 13px only
              with a mandatory /5 line box) — it is the pre-auth card scale, a
              surface-scoped exception documented in DESIGN.md > Typography >
              Hierarchy and shared with the Overview splash. Changing it changes
              both screens. */}
          <label
            htmlFor="password"
            className="text-[0.8125rem] font-semibold"
          >
            {t("login.password_label")}
          </label>

          <div className="relative flex items-center">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting || isLocked}
              aria-invalid={error !== null}
              aria-describedby={errorMessage ? "password-error" : undefined}
              className={cn(
                // Fill-only at rest: no border, no shadow. A 1px outline around
                // a filled field is two containers describing one control.
                "bg-surface-container dark:bg-surface-container rounded-field h-12 border-0 pr-12 pl-4 shadow-none",
                "placeholder:text-on-surface-variant/75",
                // Recipe 10: the ring arrives on `quick`, and is never animated
                // away — focus leaving should feel like it already left.
                "transition-[box-shadow] duration-[var(--duration-quick)] ease-out",
                "focus-visible:ring-primary/50 focus-visible:ring-[3px]",
                // The error ring REPLACES the focus ring rather than stacking
                // with it: two rings on one field is a state nobody designed.
                // `aria-invalid:ring-destructive` is not redundant with the
                // plain `ring-destructive` beside it: input.tsx's base string
                // ships `aria-invalid:ring-destructive/20`, and a variant
                // utility outranks an unvariant one no matter which side of
                // `cn()` it lands on — without this the error ring renders at
                // 20% alpha, which on a filled field is no ring at all.
                error !== null &&
                  "ring-destructive aria-invalid:ring-destructive dark:aria-invalid:ring-destructive focus-visible:ring-destructive ring-2 focus-visible:ring-2",
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              // tabIndex -1: a password reveal is a mouse/touch affordance. On a
              // keyboard it sits between the field and the submit button, which
              // is exactly where a password manager's tab-to-submit lands.
              tabIndex={-1}
              disabled={isSubmitting || isLocked}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? t("login.hide_password") : t("login.show_password")
              }
              className="text-on-surface-variant hover:text-foreground absolute right-[7px] size-[34px] rounded-full"
            >
              <MaterialSymbol
                name={showPassword ? "visibility_off" : "visibility"}
                size={19}
              />
            </Button>
          </div>

          {/* Colour is never the only carrier: the filled `error` glyph says
              "something failed" in grayscale and under deuteranopia. */}
          {errorMessage ? (
            <span
              id="password-error"
              role="alert"
              className="text-destructive inline-flex items-center gap-[7px] text-[0.8125rem] font-medium"
            >
              <MaterialSymbol
                name="error"
                filled
                size={16}
                className="flex-none"
              />
              {errorMessage}
            </span>
          ) : null}
        </motion.div>

        <motion.div variants={staggerItem} className="flex flex-col gap-3.5">
          <Button
            type="submit"
            disabled={isSubmitting || isLocked}
            aria-live="polite"
            className={cn(
              // A grid with one cell: all three labels occupy it, so the button
              // cannot resize and the labels cannot reflow past each other.
              // Body step, not the mock's 15px: DESIGN.md scopes 15px to the
              // Banner System and calls it the only sanctioned literal outside
              // the ramp, so a CTA has no claim on it. At 48px tall and full
              // width the button already carries its own emphasis.
              "rounded-pill grid h-12 w-full place-items-center text-[0.9375rem] font-semibold",
              // The locked state is a designed state, not a disabled one — the
              // default 50% disabled wash would make it look broken rather than
              // deliberately paused.
              "disabled:opacity-100",
              isLocked
                ? "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-high"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <SubmitLabel visible={!isSubmitting && !isLocked}>
              {t("login.submit")}
            </SubmitLabel>

            <SubmitLabel visible={isSubmitting}>
              {/* The only loop on this surface. 900ms linear, matching the
                  in-progress disc in components/ui/banner.tsx. */}
              <span className="inline-flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="block size-4 animate-spin rounded-full border-[2.5px] border-current border-t-transparent [animation-duration:900ms]"
                />
                {t("login.signing_in")}
              </span>
            </SubmitLabel>

            <SubmitLabel visible={isLocked}>
              <span className="inline-flex items-center gap-[9px]">
                <MaterialSymbol name="lock" size={19} className="flex-none" />
                {/* The formatted value, matching the banner above it. The key
                    used to bake its own "s" unit into the template, which the
                    mm:ss form could not wear — it is now `Locked ({{seconds}})`
                    in all five locales, so both surfaces agree past 60s. */}
                {withSlot(
                  t("login.locked", { seconds: SLOT }),
                  tabularCount(lockoutLabel),
                )}
              </span>
            </SubmitLabel>
          </Button>

          <p className="text-on-surface-variant text-center text-xs">
            {t("login.brand_label")}
          </p>
        </motion.div>
      </form>
    </motion.div>
  );
}

/**
 * One cell of the submit button's label stack. Every label is always mounted and
 * always the same cell, so the button's box is the union of all three and never
 * moves; only opacity changes.
 *
 * `visibility` rides along with opacity so the hidden labels leave the
 * accessibility tree and the keyboard order — an opacity-0 label is still
 * announced, which would read the button out as three contradictory things.
 */
function SubmitLabel({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden={!visible}
      className={cn(
        "col-start-1 row-start-1 transition-opacity duration-[var(--duration-quick)] ease-out",
        visible ? "visible opacity-100" : "invisible opacity-0",
      )}
    >
      {children}
    </span>
  );
}
