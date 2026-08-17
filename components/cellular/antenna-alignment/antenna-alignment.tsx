"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { AimConsole, CondensedAim } from "./live-aim";
import { PortStripCard } from "./port-strip";
import { PositionsCard } from "./recorder-card";
import {
  CHAINS_ROW,
  CONDENSED,
  CONSOLE,
  CONSOLE_COLUMN,
  CONSOLE_SPLIT,
  PAGE_DESCRIPTION,
  PAGE_HEADER_BLOCK,
  PAGE_SHELL,
  PAGE_TITLE,
  WORK_COLUMN,
} from "./shapes";
import { AlignmentNoReadings, AlignmentSkeleton, AlignmentUnreachable } from "./states";
import { countReportingPorts, detectRadioMode } from "./utils";

// =============================================================================
// DIRECTION CONTRACT — Antenna Alignment
// =============================================================================
// THESIS: The aim reading never leaves the screen. Refuses the stacked-cards
//   page where the live instrument scrolls away the moment the user touches
//   anything — measured at 2,353px on a phone, the score owning 17% of it and
//   an empty recorder owning 39%.
// OWN-WORLD: QManager's shipped instrument console. Neutral surfaces, colour
//   only on the reading; the five-stop quality ramp on numerals and bars;
//   outline tags for identity, filled chips for state; pill geometry over
//   36/40px cards.
// STORY: A field tech at the mast sees one score, can see what it is made of,
//   and rotates the antenna until it climbs.
// FIRST VIEWPORT: Page title, then the console — 52px composite numeral,
//   verdict chip, delta, peak tick over an 8px meter, two weighted leg rows.
//   A sticky left pane at >=896px; in flow on a phone, where a 64px pill
//   readout pins as it scrolls away. Positions fills the right column and
//   Receive Chains spans the full width beneath both.
//   (Amended at inspection. The locked card put Chains in the right column;
//   built, that ran 929px against the console's 403px and left half a desktop
//   viewport empty, and made the documented "footnote" the tallest card on the
//   page. Full width closes the columns to within 1px and lets the strip run
//   4-up. The phone order is unchanged: console, positions, chains.)
// FORM: Pinned Console; 7th of seven ranked structures; seed 8731ff15.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the
//   finish review, the verdict, DESIGN.md, and every shipping raster carrying
//   its provenance.
// =============================================================================
//
// Page shell only: the hook, state routing, the header, the degraded banner,
// and the two-column split. Every card owns its own content.
//
// The order the aiming user's questions arrive in is unchanged from the
// outgoing page and is still load-bearing:
//   1. Live Aim  — "is it better than it was a second ago?" (the sweep)
//   2. Positions — "which of these three headings won?" (the commit)
//   3. Chains    — "am I aiming with all the chains I think I have?"
//
// What changed is WHERE those live. Question 1 is continuous and the other two
// are episodic, so 1 is pinned and 2 and 3 scroll past it, rather than all
// three sharing one column at equal weight.
// =============================================================================

/** Clears the pinned bar's own top inset before the sentinel counts as gone. */
const SENTINEL_MARGIN = "-72px 0px 0px 0px";

export default function AntennaAlignmentComponent() {
  const { t, i18n } = useTranslation("cellular");
  const { data, isLoading, isStale, error, refresh } = useModemStatus();

  const spa = data?.signal_per_antenna ?? null;
  const mode = spa ? detectRadioMode(spa) : null;

  /** The first fetch never landed — we have nothing, not even a reason. */
  const unreachable = !isLoading && !data;
  /** The modem answered and every chain reported nothing. */
  const noReadings = !!spa && countReportingPorts(spa) === 0;

  const showsConsole = !isLoading && !unreachable && !noReadings && !!spa && !!mode;

  /**
   * Whether the full console has scrolled out from under the pinned bar.
   *
   * Defaults to `false` and stays there if `IntersectionObserver` never fires,
   * which satisfies the Non-Load-Bearing Rule: with the observer dead the full
   * console is on screen and the pinned bar is hidden, which is the correct
   * resting state rather than a broken one.
   */
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry != null && !entry.isIntersecting),
      { rootMargin: SENTINEL_MARGIN, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [showsConsole]);

  /**
   * The modem's own timestamp for this snapshot, rendered as a clock time.
   *
   * Deliberately the device's stamp and not an elapsed age: computing "3s ago"
   * means reading a clock during render, which `react-hooks/purity` flags and
   * `use-modem-status.ts` explicitly asks consumers not to do. A frozen clock
   * time is just as legible as a frozen counter — if the figure stops advancing,
   * the feed has stopped — and it needs no timer to stay honest.
   */
  const updatedAt =
    data?.timestamp != null
      ? new Date(data.timestamp * 1000).toLocaleTimeString(i18n.language)
      : null;

  /** Recording depends on fresh snapshots arriving; say so when they are not. */
  const feedStalled = !!error || isStale;

  return (
    <motion.div
      className={PAGE_SHELL}
      data-impeccable-seed="8731ff15"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* Zero-height, so the resting page is not 64px taller for a readout
          nobody has summoned. It pins for the page's whole scroll range and the
          bar inside it crossfades. */}
      {showsConsole && spa && (
        <div className={CONDENSED.ROOT}>
          <CondensedAim spa={spa} snapshotTs={data?.timestamp ?? null} shown={condensed} />
        </div>
      )}

      <motion.div variants={staggerItem} className={PAGE_HEADER_BLOCK}>
        <h1 className={PAGE_TITLE}>{t("antenna_alignment.page.title")}</h1>
        <p className={PAGE_DESCRIPTION}>{t("antenna_alignment.page.description")}</p>
      </motion.div>

      {/* Outside the cascade: a condition banner should arrive when the condition
          does, not on the page's entrance clock. */}
      {!isLoading && !unreachable && feedStalled && (
        <Banner
          role="stale"
          title={
            error
              ? t("antenna_alignment.states.error_banner")
              : t("antenna_alignment.states.stale_banner")
          }
        />
      )}

      {isLoading ? (
        <AlignmentSkeleton label={t("antenna_alignment.states.loading_sr")} />
      ) : unreachable ? (
        <motion.div variants={staggerItem}>
          <AlignmentUnreachable onRetry={refresh} />
        </motion.div>
      ) : noReadings ? (
        <motion.div variants={staggerItem}>
          <AlignmentNoReadings onRetry={refresh} />
        </motion.div>
      ) : spa && mode ? (
        <div className={CONSOLE_SPLIT}>
          <motion.div variants={staggerItem} className={CONSOLE_COLUMN}>
            <div className={CONSOLE.STICKY}>
              <AimConsole
                spa={spa}
                snapshotTs={data?.timestamp ?? null}
                updatedAt={updatedAt}
              />
            </div>
            {/* The tripwire for the pinned bar. Sits immediately below the
                console, INSIDE its column — a sentinel placed as a sibling grid
                item would claim a cell of its own and displace the work column
                on wide surfaces. "The console is gone" and "this is gone" are
                the same event on a phone. Never a visible box. */}
            <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          </motion.div>

          <motion.div variants={staggerItem} className={WORK_COLUMN}>
            <PositionsCard
              spa={spa}
              snapshotTs={data?.timestamp ?? null}
              feedStalled={feedStalled}
            />
          </motion.div>
        </div>
      ) : null}

      {/* Full width, beneath the split rather than inside the work column. See
          CHAINS_ROW: in the column it ran 929px against the console's 403px and
          left half a desktop viewport empty, and it was the tallest card on a
          page that documents it as a footnote. */}
      {spa && mode && !isLoading && !unreachable && !noReadings && (
        <motion.div variants={staggerItem} className={CHAINS_ROW}>
          <PortStripCard spa={spa} mode={mode} />
        </motion.div>
      )}
    </motion.div>
  );
}
