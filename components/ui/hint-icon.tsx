"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { MaterialSymbol } from "@/components/ui/material-symbol";

// =============================================================================
// HintIcon: the info tip (DESIGN.md > Components > Copy & Help)
// =============================================================================
// A popover that hover can preview. It stays a toggletip, because a Radix
// Tooltip never opens on tap and techs read this on phones and tablets:
//
//   mouse rests on the trigger    opens after HOVER_OPEN_MS, unpinned
//   mouse leaves trigger and tip  an unpinned tip closes after HOVER_CLOSE_MS
//   click, tap, Enter, Space      pins it open, or closes a pinned tip
//   Esc, pointer down outside     closes
//   focus alone                   does nothing; the tip is read via describedby
//   another tip opens             this one closes (one open app-wide)
//
// The tip is rendered straight on the Radix primitives, not through the shared
// `PopoverContent`: that wrapper carries tw-animate exit, zoom and slide classes
// that tailwind-merge can't reliably strip, and the Enter-Only Rule forbids an
// exit animation here. Don't route this back through it, and don't restyle the
// shared popover to suit the tip.
// =============================================================================

/** Hover intent before a preview opens, so crossing a form doesn't flicker tips. */
const HOVER_OPEN_MS = 300;
/** Grace period for travelling from the trigger into the tip (WCAG 1.4.13). */
const HOVER_CLOSE_MS = 120;

// One tip open at a time, app-wide. Opening a tip claims the id and notifies
// every mounted HintIcon; the one that no longer holds it closes itself.
let activeHintId: string | null = null;
const hintListeners = new Set<() => void>();

function claimActiveHint(id: string) {
  if (activeHintId === id) return;
  activeHintId = id;
  hintListeners.forEach((listener) => listener());
}

function releaseActiveHint(id: string) {
  if (activeHintId === id) activeHintId = null;
}

function subscribeActiveHint(listener: () => void) {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

export interface HintIconProps {
  /** Accessible name of the trigger. Must disambiguate when several tips share a page. */
  label: string;
  /** Tip body: at most two sentences, never the only home of a consequence. */
  children: React.ReactNode;
  /**
   * `info` (default) is the quiet glyph every existing tip wears. `warning`
   * swaps in the warning glyph and ink for a tip whose body qualifies the
   * figures beside it (a measurement that may read low). Same popover either way.
   */
  tone?: "info" | "warning";
}

/**
 * The info tip. A quiet 16px outline `info` glyph that trails its label;
 * hover previews the tip, click or tap pins it. See the header above.
 */
export function HintIcon({ label, children, tone = "info" }: HintIconProps) {
  const id = React.useId();
  const descriptionId = `${id}-description`;

  const [open, setOpen] = React.useState(false);
  // Mirrors of the state above, read from timers and pointer handlers that
  // would otherwise close over a stale render.
  const openRef = React.useRef(false);
  const pinnedRef = React.useRef(false);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelOpen = React.useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const show = React.useCallback(
    (pin: boolean) => {
      cancelOpen();
      cancelClose();
      openRef.current = true;
      pinnedRef.current = pin;
      setOpen(true);
      claimActiveHint(id);
    },
    [cancelOpen, cancelClose, id],
  );

  const hide = React.useCallback(() => {
    cancelOpen();
    cancelClose();
    openRef.current = false;
    pinnedRef.current = false;
    setOpen(false);
    releaseActiveHint(id);
  }, [cancelOpen, cancelClose, id]);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(hide, HOVER_CLOSE_MS);
  }, [cancelClose, hide]);

  // Another tip claimed the slot: step aside.
  React.useEffect(
    () =>
      subscribeActiveHint(() => {
        if (openRef.current && activeHintId !== id) hide();
      }),
    [hide, id],
  );

  // Unmounting mid-hover must not leave a timer to set state on nothing.
  React.useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
      releaseActiveHint(id);
    },
    [cancelOpen, cancelClose, id],
  );

  const handleTriggerPointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    if (!openRef.current) {
      cancelOpen();
      openTimerRef.current = setTimeout(() => show(false), HOVER_OPEN_MS);
    }
  };

  const handlePointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelOpen();
    if (openRef.current && !pinnedRef.current) scheduleClose();
  };

  const handleTriggerClick = (event: React.MouseEvent) => {
    // Skip Radix's own open toggle (composeEventHandlers checks
    // defaultPrevented); this handler owns the pin logic instead, so a click on
    // a hover-opened tip pins it rather than shutting it.
    event.preventDefault();
    if (openRef.current && pinnedRef.current) hide();
    else show(true);
  };

  // Radix only reports a close here (Esc, pointer down outside, focus moving
  // away); opening is driven entirely by the handlers above.
  const handleOpenChange = (next: boolean) => {
    if (next) show(true);
    else hide();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-describedby={descriptionId}
          onPointerEnter={handleTriggerPointerEnter}
          onPointerLeave={handlePointerLeave}
          onClick={handleTriggerClick}
          className={cn(
            "relative inline-grid size-5 shrink-0 cursor-pointer place-items-center rounded-full outline-hidden",
            "transition-[color] duration-[var(--duration-quick)] ease-out motion-reduce:transition-none",
            tone === "warning"
              ? "text-warning-on-surface"
              : "text-on-surface-variant hover:text-primary-on-surface focus-visible:text-primary-on-surface data-[state=open]:text-primary-on-surface",
            // Focus: a 3px ring over a 2px gap. An outline rather than a
            // ring-offset, so the gap is transparent and shows whatever ground
            // the trigger sits on (card, background, popover) instead of a
            // hard-coded one. `outline-hidden` sets the style to none, so the
            // focus state must restore it with `outline-solid`.
            "focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ring",
            // Hit area: 24px under a mouse, the 44px touch floor on coarse
            // pointers, without moving the layout.
            "after:absolute after:-inset-0.5 after:rounded-full after:content-[''] pointer-coarse:after:-inset-3",
          )}
        >
          <MaterialSymbol
            name={tone === "warning" ? "warning" : "info"}
            filled={open}
            size={16}
            // `.material-symbol` is unlayered CSS with a standard-duration
            // FILL transition, so only an important utility can retime it.
            className="[transition:font-variation-settings_var(--duration-quick)_ease-out]! motion-reduce:[transition:none]!"
          />
        </button>
      </PopoverPrimitive.Trigger>
      {/* The tip as the trigger's description, so a screen reader reads it on
          focus without opening anything. `hidden` rather than `sr-only`: a
          referenced hidden node still feeds aria-describedby, but stays out of
          the accessible name of a <label> the trigger sits inside and isn't
          read twice in browse mode. */}
      <span id={descriptionId} hidden>
        {children}
      </span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          // Radix gives the content role="dialog"; name it after its trigger.
          aria-label={label}
          // Focus never leaves the trigger: the tip holds no controls, and a
          // hover-close must not programmatically focus (and ring) the trigger.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={cancelClose}
          onPointerLeave={handlePointerLeave}
          className={cn(
            "z-50 w-auto max-w-[min(18rem,var(--radix-popover-content-available-width))] origin-(--radix-popover-content-transform-origin)",
            "rounded-field border bg-popover px-3.5 py-2.5 text-[0.8125rem] leading-5 text-pretty text-popover-foreground shadow-lg outline-hidden",
            // Enter only: fade, 0.96 to 1 and a 4px rise toward the trigger.
            // Closing is instant. Reduced motion keeps the fade alone. The
            // animation is gated on the open state on purpose: Radix Presence
            // unmounts at once when a closing node's animation-name is `none`,
            // but if the name is unchanged it may wait for an animationend
            // that already fired, leaving a closed tip mounted.
            "data-[state=open]:animate-in fade-in-0 zoom-in-96 duration-[var(--duration-quick)] ease-standard",
            "data-[side=top]:slide-in-from-bottom-1 data-[side=bottom]:slide-in-from-top-1",
            "motion-reduce:zoom-in-100 motion-reduce:data-[side=top]:slide-in-from-bottom-0 motion-reduce:data-[side=bottom]:slide-in-from-top-0",
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
