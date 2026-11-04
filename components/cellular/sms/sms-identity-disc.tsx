"use client";

import * as React from "react";

import { BrandMark } from "@/components/ui/brand-mark";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import { IDENTITY_DISC_CLASS, type SmsIdentity } from "./sms-identity";

// =============================================================================
// SmsIdentityDisc — the one identity disc, shared by the thread list row and
// the conversation header
// =============================================================================
// Used to be two copies of the same markup (`sms-thread-list.tsx` and
// `sms-conversation.tsx`), which is how they drifted the couple of pixels
// apart that they had. Both call sites keep their own size via
// `sizeClassName`/`glyphSize`/`textClassName` — this component only owns what
// has to stay identical: the tone fill, the fallback ladder, and the logo
// plate.
//
// Fallback ladder, in order:
//   1. `identity.logoDomain` set → the shared `BrandMark`: a mapped brand glyph,
//      else the curated domain's fetched logo (`lib/logo-store.ts`). A square
//      fetched logo fills the disc edge to edge, so it reads round.
//   2. `identity.initials` → two-letter monogram.
//   3. Neither → the person glyph.
//
// Privacy: the only value that ever reaches the brand mark (and so Google's
// Hunter / Google s2) is `identity.logoDomain`, a curated domain from
// `lib/sms-logos.ts`. A sender ID or a number never leaves the page.
//
// The mark sits on a neutral plate (`surface-container-high`, the same plate
// the Sites tiles use) that appears only while a real logo is showing, so a
// dark wordmark stays legible and the initials keep the hashed tone fill until
// a logo has actually loaded.
// =============================================================================

export interface SmsIdentityDiscProps {
  identity: SmsIdentity;
  /** Outer disc dimension classes, e.g. `"size-9"` or the thread row's responsive size. */
  sizeClassName: string;
  /** Initials text-size class, e.g. `"text-sm"` (list) or `"text-[0.8125rem]"` (header). */
  textClassName: string;
  /** Fallback person-glyph size in px. */
  glyphSize: number;
  className?: string;
}

export function SmsIdentityDisc({
  identity,
  sizeClassName,
  textClassName,
  glyphSize,
  className,
}: SmsIdentityDiscProps) {
  const fallback = identity.initials ?? <MaterialSymbol name="account_circle" size={glyphSize} />;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "rounded-pill grid flex-none place-items-center overflow-hidden font-bold",
        sizeClassName,
        textClassName,
        IDENTITY_DISC_CLASS[identity.tone],
        className,
      )}
    >
      {identity.logoDomain ? (
        <BrandMark
          // A new sender (thread switch) gets a fresh favicon state.
          key={identity.logoDomain}
          domain={identity.logoDomain}
          label={identity.title}
          className="grid size-full place-items-center rounded-full"
          logoClassName="bg-surface-container-high p-[16%]"
          // A square fetched logo fills the whole disc so it reads round.
          fillLogoClassName="bg-surface-container-high"
          glyphClassName="size-full"
          faviconClassName="size-full rounded-[2px] object-contain"
          fallback={fallback}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
