"use client";

import * as React from "react";

import { SidebarMenu } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

// =============================================================================
// NavMenu — SidebarMenu with the sliding active indicator
// =============================================================================
// Motion Study spec 3: "the active pill slides between rows instead of
// appearing." One indicator element per nav group tracks whichever top-level
// row is active, so moving Cellular Information -> Cell Scanner is a 300ms
// translate rather than one fill blinking off and another blinking on.
//
// Three deliberate constraints:
//
//   * It is not load-bearing. The indicator paints the container tone; the
//     active row independently carries darker ink, semibold weight, and a
//     filled icon. Kill the animation, kill the element entirely, and the
//     active row is still unambiguous — including in grayscale, which PRODUCT.md
//     requires because green/amber converge under deuteranopia and we do not
//     want the nav leaning on hue either.
//
//   * It never crosses a group. Each SidebarGroup owns its own indicator, so
//     the pill fades out of Cellular and fades in under Monitoring rather than
//     flying across a section heading it has no relationship to.
//
//   * It only animates transform/height/opacity, never layout. The rows own the
//     layout; the indicator is painted behind them and is pointer-transparent.
// =============================================================================

/** Top-level rows only. Sub-rows carry data-sidebar="menu-sub-button". */
const ACTIVE_ROW = '[data-sidebar="menu-button"][data-active="true"]';

interface IndicatorBox {
  top: number;
  height: number;
}

export function NavMenu({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SidebarMenu>) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<IndicatorBox | null>(null);

  // True until one frame after the first measurement, so the indicator appears
  // already under the active row on load instead of sliding down from y=0.
  const [settling, setSettling] = React.useState(true);

  React.useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const row = frame.querySelector<HTMLElement>(ACTIVE_ROW);
      if (!row) {
        // Keep the last position and fade out — a group with nothing active
        // should not snap its indicator to the top before disappearing.
        setBox(null);
        return;
      }
      const frameTop = frame.getBoundingClientRect().top;
      const rowRect = row.getBoundingClientRect();
      setBox({ top: rowRect.top - frameTop, height: rowRect.height });
    };

    measure();

    // Two independent triggers, because they catch different things:
    //   ResizeObserver — a collapsible section expanding pushes later rows down,
    //     and it fires continuously through the expansion so the indicator
    //     tracks the movement rather than jumping at the end.
    //   MutationObserver — the active row changing on navigation is an attribute
    //     flip with no size change at all, which a ResizeObserver never sees.
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(frame);

    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(frame, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-active", "data-state"],
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  React.useEffect(() => {
    if (!box || !settling) return;
    const id = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(id);
  }, [box, settling]);

  return (
    <div ref={frameRef} className="relative">
      <div
        aria-hidden="true"
        data-settling={settling}
        className="nav-indicator bg-primary-container rounded-pill pointer-events-none absolute inset-x-0 top-0 will-change-transform"
        style={{
          transform: `translateY(${box?.top ?? 0}px)`,
          height: box?.height ?? 0,
          opacity: box ? 1 : 0,
        }}
      />
      <SidebarMenu className={cn("relative gap-0.5", className)} {...props}>
        {children}
      </SidebarMenu>
    </div>
  );
}
