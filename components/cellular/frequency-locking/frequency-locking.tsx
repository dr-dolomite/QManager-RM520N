"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useFrequencyLocking } from "@/hooks/use-frequency-locking";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { NrFreqLockEntry } from "@/types/frequency-locking";

import FreqLockHero from "./freq-lock-hero";
import LteFreqCard from "./lte-freq-card";
import NrFreqCard from "./nr-freq-card";
import {
  BADGE_GLYPH_SIZE,
  CARD_CELL,
  CARD_GRID,
  EXPERIMENTAL_BADGE,
  PAGE_SHELL,
} from "./shapes";

// =============================================================================
// Frequency Locking — page shell
// =============================================================================
// Reads top to bottom as one argument: what the radio is on RIGHT NOW, then the
// two lists you are allowed to keep. Each card owns its own Apply and Clear.
//
// THE SHELL OWNS THE DRAFTS. Both cards are controlled. That is not ceremony:
// the live strip's carrier tiles each carry an Add button that pushes a channel
// into whichever list matches its radio, so the drafts have to live above both
// the strip and the cards. It also puts the seeding of a draft from the modem's
// read-back in ONE place instead of two mirrored effects — which is exactly
// where the incumbent had a bug (its LTE effect set slot 2 when the modem
// reported two channels but never CLEARED slot 2 when it reported one, so a
// stale second channel survived on screen after the lock narrowed).
//
// WHY EACH CARD KEEPS ITS OWN APPLY. The design comp put a single Apply in the
// footer bar whose label changed with whichever leg happened to be dirty. LTE
// and NR are two independent AT writes, gated independently, each costing its
// own reconnect — so one button that fires one or two of them depending on
// hidden state is precisely the ambiguity the read-back line exists to remove.
// Per-leg apply also matches Tower Locking next door, which is the page users
// arrive from. (A bottom bar once held the reconnect disclaimer, the read-back
// and Clear all; the cards' own Clear and slot rows made it redundant.)
// =============================================================================

const LTE_SLOTS = 2;
const NR_MAX_ENTRIES = 32;

export const FrequencyLockingComponent = () => {
  const { t } = useTranslation("cellular");

  const {
    modemState,
    isLoading,
    isRefreshing,
    isLteLocking,
    isNrLocking,
    error,
    lockLte,
    unlockLte,
    lockNr,
    unlockNr,
    towerLockLteActive,
    towerLockNrActive,
    towerLockStateKnown,
    towerLockLteReadOk,
    towerLockNrReadOk,
    refresh,
  } = useFrequencyLocking();

  const { data: modemData } = useModemStatus();

  // ---------------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------------
  const [lteDraft, setLteDraft] = useState<string[]>(() =>
    Array(LTE_SLOTS).fill(""),
  );
  const [nrDraft, setNrDraft] = useState<NrFreqLockEntry[]>([]);

  /**
   * Seed both drafts from the modem's read-back.
   *
   * DURING RENDER, not in an effect. This is React's documented "adjusting
   * state when a prop changes" pattern: compare against the last value seeded
   * from and set during render, so React re-renders immediately with the new
   * state instead of painting the stale draft, committing, and then painting
   * again. The effect version this replaces tripped
   * `react-hooks/set-state-in-effect` for exactly that reason — and that rule
   * bails per component, so leaving it would have hidden every later
   * diagnostic in this file.
   *
   * `modemState` is a fresh object on every successful `status.sh` read, and
   * re-seeding on each of those is the behaviour we want: this surface does not
   * poll, so a read only happens on mount, after a write, or when the user asks
   * for one — all three of which are moments the form should agree with the
   * modem rather than preserve an abandoned edit.
   *
   * The LTE draft is rebuilt from a fixed-length array rather than assigned
   * slot-by-slot, so a slot the modem no longer reports is CLEARED. The
   * incumbent only ever wrote slots it had data for, which left a stale second
   * channel on screen after a two-channel lock narrowed to one — the form then
   * disagreed with the modem while looking authoritative.
   */
  const [seededFrom, setSeededFrom] = useState<typeof modemState>(null);

  if (modemState && modemState !== seededFrom) {
    setSeededFrom(modemState);

    const nextLte: string[] = Array(LTE_SLOTS).fill("");
    modemState.lte_entries.slice(0, LTE_SLOTS).forEach((entry, i) => {
      nextLte[i] = String(entry.earfcn);
    });
    setLteDraft(nextLte);

    setNrDraft(modemState.nr_entries.slice(0, NR_MAX_ENTRIES).map((e) => ({ ...e })));
  }

  // ---------------------------------------------------------------------------
  // Adding a live carrier to its list, from the strip above
  // ---------------------------------------------------------------------------
  const handleAddChannel = useCallback(
    (technology: "LTE" | "NR", channel: number, scs: number | null) => {
      if (technology === "LTE") {
        setLteDraft((prev) => {
          if (prev.includes(String(channel))) return prev;
          const next = [...prev];
          // First free slot, else overwrite the last — the LTE lock takes two
          // channels and no more, so there is nowhere else for a third to go.
          const free = next.findIndex((v) => v.trim() === "");
          next[free === -1 ? LTE_SLOTS - 1 : free] = String(channel);
          return next;
        });
        return;
      }

      setNrDraft((prev) => {
        if (prev.some((e) => e.arfcn === channel)) return prev;
        if (prev.length >= NR_MAX_ENTRIES) return prev;
        // `scs` is null when the modem did not report a spacing for THIS
        // carrier — only the serving NR cell publishes one. Fall back to the
        // most common SA/NSA spacing rather than blocking the add; the card's
        // own control lets the user correct it, and the SCS warning notice
        // beside the list says why that matters.
        return [...prev, { arfcn: channel, scs: scs ?? 30 }];
      });
    },
    [],
  );

  // The strip's gate is the union: the page is blocked when either radio is
  // held by a tower lock, because the verdict it renders is page-level.
  const anyTowerLock = towerLockLteActive || towerLockNrActive;

  const header = useMemo(
    () => (
      <span className="flex flex-wrap items-center gap-2.5">
        {t("frequency_locking.page.title")}
        <Badge variant={EXPERIMENTAL_BADGE.variant}>
          <MaterialSymbol
            name={EXPERIMENTAL_BADGE.glyph}
            size={BADGE_GLYPH_SIZE}
          />
          {t("frequency_locking.page.experimental")}
        </Badge>
      </span>
    ),
    [t],
  );

  return (
    <motion.div
      className={PAGE_SHELL}
      variants={staggerContainer}
      initial="hidden"
      // "visible", NOT "show". `staggerContainer`/`staggerItem` in `lib/motion.ts`
      // name their settled state `visible`. A name that matches no variant is not
      // an error in Motion — it simply has nothing to animate to, so every
      // `staggerItem` child stays pinned at `hidden` (`opacity: 0`) forever and
      // the whole page renders as a correct, fully-populated, INVISIBLE DOM. It
      // type-checks, builds, and passes every static gate, because `animate`
      // takes an arbitrary string. The only detector is looking at it.
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <CellularPageHeader
          title={header}
          description={t("frequency_locking.page.description")}
          actions={
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={refresh}
              disabled={isLoading || isRefreshing || isLteLocking || isNrLocking}
            >
              <MaterialSymbol
                name="refresh"
                size={18}
                className={isRefreshing ? "motion-safe:animate-spin" : undefined}
              />
              {t("frequency_locking.actions.refresh")}
            </Button>
          }
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <FreqLockHero
          modemState={modemState}
          modemData={modemData}
          isLoading={isLoading}
          loadError={error}
          towerLockActive={anyTowerLock}
          towerLockStateKnown={towerLockStateKnown}
          onAddChannel={handleAddChannel}
        />
      </motion.div>

      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <LteFreqCard
            draft={lteDraft}
            onDraftChange={setLteDraft}
            modemState={modemState}
            modemData={modemData}
            isLoading={isLoading}
            isLocking={isLteLocking}
            towerLockActive={towerLockLteActive}
            towerLockReadOk={towerLockLteReadOk}
            onLock={lockLte}
            onUnlock={unlockLte}
          />
        </motion.div>

        <motion.div variants={staggerItem} className={CARD_CELL}>
          <NrFreqCard
            draft={nrDraft}
            onDraftChange={setNrDraft}
            modemState={modemState}
            modemData={modemData}
            isLoading={isLoading}
            isLocking={isNrLocking}
            towerLockActive={towerLockNrActive}
            towerLockReadOk={towerLockNrReadOk}
            onLock={lockNr}
            onUnlock={unlockNr}
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default FrequencyLockingComponent;
