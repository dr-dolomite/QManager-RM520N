"use client";

import * as React from "react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol-names";
import { cn } from "@/lib/utils";

// =============================================================================
// TonalBanner — the in-card notice (DESIGN.md > Banner System, card-scoped)
// =============================================================================
// The sibling of `components/ui/banner.tsx`, not a replacement for it. The two
// are split by WHERE they mount, and everything else follows from that:
//
//   Banner       page-level. Eight named system roles, a CTA slot, a dismiss
//                slot, a 36px disc, lucide glyphs (it mounts on every route, so
//                the Icon-Boundary Rule pins it to lucide).
//   TonalBanner  inside a single card, on any Material-side route. Three tones,
//                no CTA, no dismiss, a 32px disc, and Material Symbols.
//
// It began pre-auth-only, because `/` and `/login/` were the first routes the
// product owner brought under the Icon-Boundary Rule. That scope is no longer
// the constraint: the rule now covers the sidebar, `/dashboard`, the two
// pre-auth routes AND all of `/cellular/`, so this primitive is legal on every
// one of them — `/cellular/sms/forwarding` is the first `/cellular/` consumer,
// where it replaced a hand-rolled notice that had drifted to a 28px radius, no
// entrance animation and no `break-words`. What still scopes it is the MOUNT
// POINT, not the route: inside one card, `TonalBanner`; at page level,
// `components/ui/banner.tsx`.
//
// It exists because a page-level Banner dropped inside a 404px login card is
// the wrong instrument: its CTA lane, dismiss lane and 300px text basis all
// assume a full content column, and its role vocabulary ("sim-swap-matched",
// "deferred-reboot") describes conditions a signed-out visitor cannot act on.
//
// What it keeps from the page-level primitive, because these are the rules and
// not the geometry:
//
//   Solid-Container Rule  bg-{role}-container + text-on-{role}-container. Never
//                         a wash. `border-warning/30 bg-warning/10` — the
//                         pattern this component retires from /login — is not a
//                         stable colour: a 10% alpha over a tinted surface
//                         collapses in dark mode and washes out first in
//                         sunlight.
//   Glyph-Disc Rule       The icon always sits in a filled circle on the role's
//                         STRONG fill. The disc is what survives when the
//                         container fill washes out; a bare icon on the
//                         container does not.
//   Info-Is-Brand         The informational tone uses primary-container. There
//                         is no separate info hue.
//   Field radius          20px (`rounded-field`), per the Banner System's own
//                         reasoning: a banner must not out-round the surface it
//                         sits on. The mock draws 24px/22px, which is not a step
//                         on this repo's shape scale (12/20/28/36/40) — see the
//                         `size` prop.
//
// Motion: `.animate-banner-in` (400ms emphasized, 6px rise + fade) already
// ships in globals.css with its prefers-reduced-motion guard. Enter only — a
// banner leaving means the condition cleared, and that should feel immediate.
// =============================================================================

export type TonalBannerTone = "warning" | "destructive" | "info";

type ToneMeta = {
  /** Solid tonal container plus its measured ink. */
  container: string;
  /** Filled glyph disc, on the role's strong fill. */
  disc: string;
  /** Default landmark role. Overridable via the `role` prop. */
  ariaRole: "alert" | "status";
};

const TONE_META: Record<TonalBannerTone, ToneMeta> = {
  warning: {
    container: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    ariaRole: "alert",
  },
  destructive: {
    container: "bg-destructive-container text-on-destructive-container",
    disc: "bg-destructive text-destructive-foreground",
    ariaRole: "alert",
  },
  info: {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    ariaRole: "status",
  },
};

export interface TonalBannerProps {
  tone: TonalBannerTone;
  /** Material Symbol ligature name for the icon disc. */
  icon: MaterialSymbolName;
  /** Bold first line. Omit for the compact single-line form. */
  title?: React.ReactNode;
  /** Body line, or the sole line when `title` is absent. */
  children: React.ReactNode;
  /**
   * "default" — 20px radius / 14px-16px padding / 32px disc / items-start.
   * "compact" — 20px radius / 11px-14px padding / 30px disc / items-center.
   *
   * Both land on `rounded-field`. The mock's 24px and 22px are a two-step
   * distinction the repo's shape scale does not carry, and inventing an
   * arbitrary radius for a 2px difference costs more than it buys: the two
   * sizes are already told apart by padding, disc size and alignment.
   */
  size?: "default" | "compact";
  /** Defaults to "alert" for warning/destructive, "status" for info. */
  role?: "alert" | "status";
  className?: string;
}

export function TonalBanner({
  tone,
  icon,
  title,
  children,
  size = "default",
  role,
  className,
}: TonalBannerProps) {
  const meta = TONE_META[tone];
  const compact = size === "compact";

  return (
    <div
      data-slot="tonal-banner"
      data-tone={tone}
      data-size={size}
      role={role ?? meta.ariaRole}
      className={cn(
        "animate-banner-in rounded-field flex w-full",
        // items-start on the default form because a wrapped two-line body would
        // otherwise drag the disc to the optical centre of a paragraph rather
        // than to the title it belongs to. The compact form is a single line,
        // where centred is correct.
        compact
          ? "items-center gap-[11px] px-[14px] py-[11px]"
          : "items-start gap-3 px-4 py-[14px]",
        meta.container,
        className,
      )}
    >
      {/* Glyph-Disc Rule — always a filled circle, never a bare icon. */}
      <span
        aria-hidden="true"
        className={cn(
          "grid flex-none place-items-center rounded-full",
          compact ? "size-[30px]" : "size-8",
          meta.disc,
        )}
      >
        {/* `filled` is not decoration: at 17-18px inside a 30-32px disc the
            outlined axis leaves too little ink to read the glyph apart from its
            neighbours, and the glyph is the ONLY non-chromatic difference
            between two tonal containers that measure ~1:1 apart in luminance. */}
        <MaterialSymbol name={icon} filled size={compact ? 17 : 18} />
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? (
          <span className="text-sm leading-[1.35] font-semibold">{title}</span>
        ) : null}
        <span
          className={cn(
            // `break-words` is load-bearing, not tidiness. Banners carry raw
            // device strings — `+CME ERROR: 4`, a negotiated APN, an apply
            // failure detail — which have no break opportunities. `min-w-0`
            // stops such a string widening the banner's PARENT, but it does
            // not stop the string itself painting past the banner's own box,
            // where an ancestor `overflow-hidden` (every dialog on this
            // surface sets one) then clips it mid-word. Only an explicit
            // break opportunity keeps it inside. Text that already fits is
            // unaffected — this rule only engages on an overlong single word.
            "min-w-0 break-words text-[13px]",
            // The body is a supporting line under a title, and the sole line
            // without one — so it carries a touch more weight when it is
            // standing alone, matching the compact banner in the mock.
            title
              ? "leading-[1.45] opacity-90"
              : "leading-[1.4] font-medium",
          )}
        >
          {children}
        </span>
      </div>
    </div>
  );
}

export default TonalBanner;
