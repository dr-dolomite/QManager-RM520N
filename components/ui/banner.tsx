"use client";

import * as React from "react";
import { cva } from "class-variance-authority";
import {
  AlertCircleIcon,
  CardSimIcon,
  CheckCircle2Icon,
  InfoIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// =============================================================================
// Banner — the page-level banner primitive (DESIGN.md > Banner System)
// =============================================================================
// A banner states a condition or notice about the SYSTEM. Eight roles, ONE
// anatomy, no per-feature variants:
//
//   container -> 36px filled glyph disc -> text block (title / identity /
//   description) -> one pill CTA -> optional dismiss
//
// The named rules this primitive enforces:
//
//   Solid-Container Rule    bg-{role}-container + text-on-{role}-container.
//                           Never a wash (`border-info/30 bg-info/10` is the
//                           retired pattern) — a 10% alpha over a tinted
//                           surface is not a stable colour: it collapses in
//                           dark mode and washes out first in sunlight. No
//                           border on any banner.
//   Glyph-Disc Rule         The icon always sits in a filled circle. The disc
//                           is what survives when the container fill washes
//                           out; a bare icon on the container does not.
//   One-CTA Rule            Exactly one action. `deferred-reboot` is the sole
//                           exception (tonal "Review" + destructive "Reboot").
//   Dismiss-Only-Notices    The X renders only for true notifications
//                           (sim-swap-*, success). Conditions leave when the
//                           condition leaves — nothing reporting a broken link
//                           gets a dismiss.
//   Info-Is-Brand           Informational banners use primary-container, never
//                           a separate info hue.
//   Icon-Boundary Rule      Material Symbols are scoped to the sidebar, the
//                           dashboard route, the two pre-auth routes (/ and
//                           /login/) and the entire /cellular/ family; every
//                           other route is lucide. This banner is
//                           ROUTE-AGNOSTIC — it mounts on Cellular, Monitoring
//                           and System Settings pages alike — so it cannot know
//                           which side of the boundary it will land on, and
//                           stays on lucide-react everywhere. That is the rule
//                           working, not an exception to it.
//
// Motion: `.animate-banner-in` (400ms emphasized, 6px rise + fade) already
// ships in globals.css together with its prefers-reduced-motion guard. There is
// deliberately NO exit animation — a banner leaving means the condition
// cleared, and that should feel immediate.
// =============================================================================

export type BannerRole =
  | "sim-swap-matched"
  | "sim-swap-unmatched"
  | "stale"
  | "degraded"
  | "in-progress"
  | "success"
  | "override"
  | "deferred-reboot";

type RoleMeta = {
  /** Solid tonal container + its measured ink. */
  container: string;
  /** Filled glyph disc. */
  disc: string;
  /** Default lucide glyph (overridable via the `icon` prop). */
  icon: LucideIcon | null;
  ariaRole: "alert" | "status" | "note";
  /** Only the stale-data banner interrupts. */
  assertive?: boolean;
  /** Dismiss-Only-Notices Rule. */
  dismissible?: boolean;
};

const ROLE_META: Record<BannerRole, RoleMeta> = {
  "sim-swap-matched": {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    icon: CardSimIcon,
    ariaRole: "alert",
    dismissible: true,
  },
  "sim-swap-unmatched": {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    icon: CardSimIcon,
    ariaRole: "alert",
    dismissible: true,
  },
  stale: {
    container: "bg-destructive-container text-on-destructive-container",
    disc: "bg-destructive text-destructive-foreground",
    icon: AlertCircleIcon,
    ariaRole: "alert",
    assertive: true,
  },
  degraded: {
    container: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    icon: TriangleAlertIcon,
    ariaRole: "alert",
  },
  "in-progress": {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    // No glyph — the disc holds a spinner instead.
    icon: null,
    ariaRole: "status",
  },
  success: {
    container: "bg-success-container text-on-success-container",
    disc: "bg-success text-success-foreground",
    icon: CheckCircle2Icon,
    ariaRole: "status",
    dismissible: true,
  },
  // The neutral exception: a page-scoped note, not a system condition. Ink is
  // `on-surface` (not an `on-*-container`) and its glyph is the one unfilled
  // disc in the set.
  override: {
    container: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    icon: InfoIcon,
    ariaRole: "note",
  },
  "deferred-reboot": {
    container: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    icon: RotateCcwIcon,
    ariaRole: "alert",
  },
};

/**
 * Pill CTA styling for the banner `action` slot. Exported so callers compose
 * the one (or, for `deferred-reboot`, two) buttons without re-deriving the
 * 10px/18px pill metrics.
 *
 * `on-warning` is the white-alpha secondary used by the safe action in a
 * warning-toned banner — deliberately different in light vs dark because a
 * fixed alpha over two very different container values is not one colour.
 */
export const bannerActionVariants = cva(
  // NOTE: the focus ring is declared PER TONE, not here. A shared
  // `ring-current` would draw the ring in the button's own ink — e.g.
  // `primary-foreground` (L 0.99) against the `primary-container` the banner
  // sits on (L 0.885), about 1.15:1, i.e. invisible. The ring has to be drawn
  // in the CONTAINER's ink, offset in the CONTAINER's fill.
  "inline-flex flex-none items-center justify-center gap-2 rounded-full px-[18px] py-[10px] text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-[17px] [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-on-primary-container focus-visible:ring-offset-primary-container",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-on-destructive-container focus-visible:ring-offset-destructive-container",
        success:
          "bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-on-success-container focus-visible:ring-offset-success-container",
        warning:
          "bg-warning text-warning-foreground hover:bg-warning/90 focus-visible:ring-on-warning-container focus-visible:ring-offset-warning-container",
        tonal:
          "bg-primary-container text-on-primary-container hover:bg-primary-container/80 focus-visible:ring-on-primary-container focus-visible:ring-offset-surface-container",
        "on-warning":
          "bg-white/55 text-on-warning-container hover:bg-white/70 dark:bg-white/14 dark:hover:bg-white/20 focus-visible:ring-on-warning-container focus-visible:ring-offset-warning-container",
      },
    },
    defaultVariants: { tone: "primary" },
  }
);

export interface BannerProps {
  role: BannerRole;
  /** Overrides the role's default glyph. */
  icon?: LucideIcon;
  title?: React.ReactNode;
  /** Machine-voice identity row (e.g. carrier · MSISDN). */
  identity?: React.ReactNode;
  description?: React.ReactNode;
  /** One pill button. `deferred-reboot` may pass two (safe action first). */
  action?: React.ReactNode;
  /** The X renders only if this is provided AND the role is dismissible. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** `in-progress` dot row, replacing the CTA slot. */
  steps?: { total: number; current: number };
  className?: string;
}

export function Banner({
  role,
  icon,
  title,
  identity,
  description,
  action,
  onDismiss,
  dismissLabel,
  steps,
  className,
}: BannerProps) {
  const meta = ROLE_META[role];
  const isOverride = role === "override";
  const isProgress = role === "in-progress";

  // Dismiss-Only-Notices Rule: a handler on a condition role is ignored.
  const showDismiss = Boolean(onDismiss) && Boolean(meta.dismissible);

  const Icon = icon ?? meta.icon;

  // The dot row (in-progress) takes the CTA slot when present.
  const trailing = steps ? (
    <div
      className="flex flex-none items-center gap-[5px]"
      aria-hidden="true"
    >
      {Array.from({ length: steps.total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-[7px] rounded-full",
            i < steps.current ? "bg-primary" : "bg-on-primary-container/25"
          )}
        />
      ))}
    </div>
  ) : action ? (
    <div className="flex flex-none flex-wrap items-center gap-2">{action}</div>
  ) : null;

  const textColumn = (
    <div
      className={cn(
        // The width floor lives on `basis`, not `min-width`: basis still
        // triggers the wrap that pushes the CTA below the text, but `min-w-0`
        // lets the column shrink once it is already on its own line. A real
        // `min-width` here cannot shrink, so it overflows a 320px phone — and
        // the quick-glance session is usually on a phone beside the modem.
        "flex min-w-0 grow flex-col",
        showDismiss ? "basis-[280px] gap-[3px]" : "basis-[300px] gap-0.5"
      )}
    >
      {title ? (
        <span
          className={
            isOverride
              ? "text-sm leading-[1.5]"
              : "text-[0.9375rem] font-semibold tracking-[-0.005em]"
          }
        >
          {title}
        </span>
      ) : null}

      {identity ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {identity}
        </div>
      ) : null}

      {description ? (
        <span
          className={cn(
            "text-[13px] leading-[1.5]",
            isOverride ? "text-on-surface-variant" : "opacity-90"
          )}
        >
          {description}
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      data-slot="banner"
      data-role={role}
      role={meta.ariaRole}
      aria-live={meta.assertive ? "assertive" : undefined}
      className={cn(
        "animate-banner-in w-full rounded-field",
        // Two shapes: the dismissible one reserves a 52px right lane for the
        // absolutely-positioned X; the condition shape is a plain centred row.
        showDismiss
          ? "relative flex items-start gap-[14px] py-4 pl-[18px] pr-[52px]"
          : "flex flex-wrap items-center gap-[14px] px-[18px] py-[14px]",
        meta.container,
        className
      )}
    >
      {/* Glyph-Disc Rule — always a filled 36px circle, never a bare icon. */}
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 flex-none place-items-center rounded-full",
          meta.disc
        )}
      >
        {/* An explicit `icon` wins even on `in-progress`. That role defaults to
            a spinner because it usually narrates live work, but it is also the
            right container for a calm standing notice ("a reboot is needed
            later"), and a spinner there would advertise activity that is not
            happening. `in-progress` has no default glyph, so `Icon` is set only
            when a caller passed one — existing spinner callers are unaffected. */}
        {Icon ? (
          <Icon className="size-5" />
        ) : isProgress ? (
          <span className="block size-[17px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent [animation-duration:900ms]" />
        ) : null}
      </span>

      {showDismiss ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
          {textColumn}
          {trailing}
        </div>
      ) : (
        <>
          {textColumn}
          {trailing}
        </>
      )}

      {showDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          // 30px visual disc, but a `before:` overlay expands the hit target to
          // the 44px the project requires without disturbing the layout.
          className="absolute right-3 top-3 grid size-[30px] place-items-center rounded-full bg-transparent text-current opacity-70 transition-opacity before:absolute before:-inset-[7px] before:content-[''] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <XIcon className="size-[18px]" />
        </button>
      ) : null}
    </div>
  );
}

export default Banner;
