"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useTowerLocking } from "@/hooks/use-tower-locking";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { CarrierComponent } from "@/types/modem-status";
import type { LteLockCell, NrSaLockCell } from "@/types/tower-locking";

import TowerAutomationTiles from "./automation-tiles";
import TowerLiveStrip from "./live-strip";
import LteTowerCard from "./lte-tower-card";
import NrSaTowerCard from "./nr-sa-tower-card";
import { defaultScsForBand } from "./simple-mode-utils";
import {
  HERO_REFRESH_BUTTON,
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION,
  SECTION_HEAD,
  SKELETON_SHAPE,
  TOWER_CARD,
  TOWER_HERO,
  TOWER_SECTION,
  CARD_PAD,
  type TowerLeg,
} from "./shapes";

// =============================================================================
// TowerLockingComponent — page coordinator for /cellular/cell-locking/tower-locking
// =============================================================================
// Owns every hook and distributes data down as props. No child talks to CGI.
//
// Data sources:
//   useModemStatus()   -> carrier_components, network.type, per-leg RSRP/PCI/SCS
//   useTowerLocking()  -> config, modemState, failoverState, lock/settings actions
//
// -----------------------------------------------------------------------------
// PAGE ANATOMY
// -----------------------------------------------------------------------------
// A page header, then TWO SIBLING SECTIONS, then the leg cards:
//
//   1. "RIGHT NOW"     (`TOWER_HERO`) the PREMISE: the lock verdict, and every
//                      carrier the radio is camped on as a uniform tile grid.
//                      It leads because it is the only part of the page that
//                      changes on its own — everything below it changes only
//                      when the reader changes it. It takes the surface's one
//                      `rounded-hero` anchor for that reason.
//   2. "WHILE NOBODY
//      IS WATCHING"    (`TOWER_SECTION`) the STANDING ORDERS: what this lock
//                      does unattended — across a reboot, during a signal
//                      collapse, and on a clock. `rounded-card`, because it is
//                      a peer of the leg cards and not a second anchor.
//   3. LEG CARDS       a 2-up of the two AT lock parameters. Where the target
//                      changes, and the single place a leg's own state is
//                      reported.
//
// DO NOT RE-MERGE 1 AND 2. They were one hero for a revision, and the merge is
// what forced the freshness stamp down onto the verdict block: a stamp at the
// top of a card that ALSO contained three settings tiles would have appeared to
// date the settings. Split, the stamp heads the section it actually describes —
// both of the verdict's operands (the ~4s carrier list and the once-on-mount
// `AT+QNWLOCK` read-back) live in section 1, and nothing else does. A merged
// hero also gave the page a single title, which had to be the automation copy,
// leaving the live strip as an unlabelled preamble under a heading about
// reboots.
//
// THIS COORDINATOR OWNS BOTH SECTION SHELLS AND BOTH SECTION HEADERS. The two
// children render only their bodies, via the shared `SECTION_HEAD` object here.
// A child rendering its own `Card` would put a card inside a section, and a
// child rendering its own heading would let the two sections' header geometry
// drift apart.
//
// Three earlier arrangements are worth not restoring.
//
// A 2x2 grid put a read-only status card and three control surfaces on the page
// as visual peers, which said all four were the same kind of object. Replacing it
// with a hero fixed that but left the schedule as an orphaned third cell in a
// 2-up grid, beside empty space, at the same rank as the two lock forms — so the
// page still read as "status, controls, and a leftover".
//
// Grouping the three unattended behaviours into a section of their own fixed the
// orphan, but left the page led by a three-column MATCH LINE whose left panel
// restated, one layer removed, the two facts the leg cards already carry: which
// leg is locked, and to what. A reader met the same pair of numbers twice before
// reaching a single control, and the read-only half of a settings page was the
// tallest thing on it. So that panel is gone and its one non-duplicated fact
// (the modem's AT read-back, as against the config the forms are seeded from)
// moved into the leg card that owns it.
//
// The order — premise, then standing orders, then forms — is the honest one for
// a page whose target is set once and whose unattended behaviour is checked
// every visit. The three-field forms come last because after the first session
// they are the part nobody opens.
//
// -----------------------------------------------------------------------------
// THE PREFILL BUS
// -----------------------------------------------------------------------------
// Clicking "use this cell" on a hero tile has to reach a form owned by a
// sibling card, so the container brokers it. The payload carries a NONCE
// because picking the SAME cell twice must still register: without it, a second
// click produces an identical object and the receiving card's render-time
// comparison sees no change.
// =============================================================================

const TowerLockingComponent = () => {
  const { t } = useTranslation("cellular");
  const { data: modemData } = useModemStatus();
  const tower = useTowerLocking();

  // --- The prefill bus --------------------------------------------------------
  const [ltePrefill, setLtePrefill] = useState<{
    cell: LteLockCell;
    nonce: number;
  } | null>(null);
  const [nrPrefill, setNrPrefill] = useState<{
    cell: NrSaLockCell;
    nonce: number;
  } | null>(null);
  const [nonce, setNonce] = useState(0);

  /** Free LTE slots, reported up by the card because it owns unsaved edits. */
  const [lteFreeSlots, setLteFreeSlots] = useState(3);

  const networkType = modemData?.network?.type ?? "";
  const carriers = useMemo(
    () => modemData?.network?.carrier_components ?? [],
    [modemData?.network?.carrier_components],
  );
  const lteCarriers = useMemo(
    () => carriers.filter((c) => c.technology === "LTE"),
    [carriers],
  );
  const nrCarriers = useMemo(
    () => carriers.filter((c) => c.technology === "NR"),
    [carriers],
  );

  /**
   * Which legs can currently accept a target from a tile, and why not when they
   * cannot. The hero renders the reason in a tooltip rather than hiding the
   * control — a missing button leaves the user to infer the rule.
   */
  const canTarget: Record<TowerLeg, { ok: boolean; reasonKey: string | null }> =
    useMemo(() => {
      const nrBlocked =
        networkType === "5G-NSA"
          ? "tower_locking.live.tile_blocked_nsa"
          : networkType === "LTE" || networkType === ""
            ? "tower_locking.live.tile_blocked_lte_only"
            : null;
      return {
        lte:
          lteFreeSlots > 0
            ? { ok: true, reasonKey: null }
            : {
                ok: false,
                reasonKey: "tower_locking.live.tile_blocked_slots_full",
              },
        nr_sa: nrBlocked
          ? { ok: false, reasonKey: nrBlocked }
          : { ok: true, reasonKey: null },
      };
    }, [networkType, lteFreeSlots]);

  /**
   * Route a picked carrier to the leg that can lock it, filling in the fields
   * the tile does not itself carry.
   *
   * SCS is the interesting one: `carrier_components` has no SCS field, so an NR
   * pick has to source it. If the picked cell IS the cell the modem is camped
   * on, the serving-cell reading is authoritative; otherwise it falls back to
   * the band default, and the card flags that as a guess. A wrong SCS makes the
   * modem accept the lock and then never camp, so which of the two produced the
   * number is worth carrying.
   */
  const handlePickCarrier = useCallback(
    (c: CarrierComponent) => {
      if (c.earfcn === null || c.pci === null) return;
      const next = nonce + 1;
      setNonce(next);

      if (c.technology === "LTE") {
        setLtePrefill({
          cell: { earfcn: c.earfcn, pci: c.pci },
          nonce: next,
        });
      } else {
        // `band` arrives as a designator like "NR5G BAND 41" or "N41"; the lock
        // command wants the integer.
        const bandNumber = Number.parseInt(
          String(c.band).replace(/[^0-9]/g, ""),
          10,
        );
        // Bind to a local before the null test: narrowing does not survive an
        // optional chain, so `modemData?.nr?.scs != null` would not make the
        // property itself non-nullable in the true branch.
        const servingScs = modemData?.nr?.scs ?? null;
        const isServing =
          modemData?.nr?.arfcn === c.earfcn && modemData?.nr?.pci === c.pci;
        // `defaultScsForBand` is typed `number | null` and returns null only for
        // a null band. `?? 30` is its own general-case answer, not an invented
        // constant — and the card flags any band-derived SCS as a guess anyway.
        const scs =
          isServing && servingScs !== null
            ? servingScs
            : (defaultScsForBand(bandNumber) ?? 30);
        setNrPrefill({
          cell: {
            pci: c.pci,
            arfcn: c.earfcn,
            scs,
            band: Number.isNaN(bandNumber) ? 0 : bandNumber,
          },
          nonce: next,
        });
      }

      toast.success(
        t("tower_locking.toast.filled", {
          leg: t(
            c.technology === "LTE"
              ? "tower_locking.short.lte"
              : "tower_locking.short.nr_sa",
          ),
          band: c.band,
          pci: c.pci,
        }),
      );
    },
    [nonce, modemData?.nr?.arfcn, modemData?.nr?.pci, modemData?.nr?.scs, t],
  );

  // --- Settings writes --------------------------------------------------------
  // Each of these needs the OTHER half of the settings payload, because
  // `settings.sh` takes persist + failover together.
  const handlePersist = useCallback(
    async (enabled: boolean) => {
      if (!tower.config) return false;
      return tower.updateSettings(enabled, tower.config.failover);
    },
    [tower],
  );

  const handleFailover = useCallback(
    async (enabled: boolean) => {
      if (!tower.config) return false;
      return tower.updateSettings(tower.config.persist, {
        ...tower.config.failover,
        enabled,
      });
    },
    [tower],
  );

  const handleThreshold = useCallback(
    async (threshold: number) => {
      if (!tower.config) return false;
      return tower.updateSettings(tower.config.persist, {
        ...tower.config.failover,
        threshold,
      });
    },
    [tower],
  );

  /** The RSRP of whichever leg the modem is actually registered on. */
  const activeRsrp =
    networkType === "5G-SA"
      ? (modemData?.nr?.rsrp ?? null)
      : (modemData?.lte?.rsrp ?? null);

  const warningKey = tower.lastWarning
    ? `tower_locking.warning.${tower.lastWarning}`
    : null;

  return (
    // Root shape shared with the migrated `/cellular/` surfaces: the page gutter
    // on this family is `p-2` over the shell's own padding, and every sub-route
    // declaring its own `@container/main` is what makes a card's `@3xl/main:`
    // resolve against the content column instead of the viewport.
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("tower_locking.page.title")}
        description={t("tower_locking.page.description")}
        actions={
          /* The scanner is where a target comes from when the cell you want is
             not one the modem is already camped on, so it belongs beside the
             page it feeds rather than only in the sidebar. `variant="tonal"`
             and not `default`: this navigates, it does not write to the radio,
             and the page's real primary actions are the leg cards' Lock
             buttons. Same key and same route as the band-locking hero's link —
             one translated sentence for one destination. */
          <Button asChild variant="tonal" className={PILL_ACTION}>
            <Link href="/cellular/cell-scanner">
              <MaterialSymbol name="radar" size={18} />
              {t("radio_info.bands.scanner.link")}
            </Link>
          </Button>
        }
      />

      {/* The surface had NO error state: `tower.error` was returned by the hook
          and passed to nobody, so a `status.sh` that failed all three retries
          rendered empty defaults as though they were real readings. */}
      {tower.error && !tower.isLoading ? (
        <div
          role="alert"
          className={`${TOWER_CARD} ${CARD_PAD} gap-4 py-6`}
        >
          <div className={`${NOTICE.ROOT} ${NOTICE_TONE.destructive.fill}`}>
            <span
              aria-hidden="true"
              className={`${NOTICE.DISC} ${NOTICE_TONE.destructive.disc}`}
            >
              <MaterialSymbol
                name={NOTICE_TONE.destructive.glyph}
                size={16}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-semibold">{t("tower_locking.error.title")}</p>
              <p className="leading-relaxed">{t("tower_locking.error.body")}</p>
            </div>
          </div>
          {/* THE RETRY IS THE ONLY WAY OUT OF THIS STATE, AND IT USED TO GO
              SILENT. It was `disabled={isRefreshing}` and nothing else: no
              spinner, no label change, no reason, no announcement — so a press
              on a slow modem looked exactly like a press that did nothing, and
              the obvious response is to press it again.

              Four channels now say the retry is running: the glyph spins, the
              label swaps, the reason is on the control (`aria-disabled` +
              tooltip, so it survives keyboard focus — see
              `cell-scanner/sibling-link.tsx`), and the `aria-live` below
              announces it once. */}
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={
                    tower.isRefreshing ? undefined : () => void tower.refresh()
                  }
                  aria-disabled={tower.isRefreshing || undefined}
                  aria-label={
                    tower.isRefreshing
                      ? `${t("tower_locking.error.retry")} — ${t("tower_locking.blocked.refresh_in_flight")}`
                      : t("tower_locking.error.retry")
                  }
                  className={`${PILL_ACTION} aria-disabled:cursor-not-allowed aria-disabled:opacity-55`}
                >
                  <MaterialSymbol
                    name={tower.isRefreshing ? "progress_activity" : "refresh"}
                    size={18}
                    className={
                      tower.isRefreshing
                        ? "animate-spin motion-reduce:animate-none"
                        : undefined
                    }
                  />
                  {tower.isRefreshing
                    ? t("tower_locking.error.retrying")
                    : t("tower_locking.error.retry")}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                {tower.isRefreshing
                  ? t("tower_locking.blocked.refresh_in_flight")
                  : t("tower_locking.error.retry_tip")}
              </TooltipContent>
            </Tooltip>
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {tower.isRefreshing ? t("tower_locking.a11y.refreshing") : ""}
            </span>
          </div>
        </div>
      ) : null}

      {/* Partial success from the last write. Warning, not error: the operation
          landed on the modem — something alongside it did not. */}
      {warningKey ? (
        <div
          role="status"
          className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.fill}`}
        >
          <span
            aria-hidden="true"
            className={`${NOTICE.DISC} ${NOTICE_TONE.warning.disc}`}
          >
            <MaterialSymbol name={NOTICE_TONE.warning.glyph} size={16} />
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            {t(warningKey)}
          </span>
          <button
            type="button"
            onClick={tower.clearWarning}
            aria-label={t("tower_locking.warning.dismiss")}
            className={NOTICE.DISMISS}
          >
            <MaterialSymbol name="close" size={16} />
          </button>
        </div>
      ) : null}

      <motion.div
        className="flex flex-col gap-5"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        {/* --- 1. Right now ------------------------------------------------
            The premise: the verdict, and every carrier on air as a picker.
            `aria-labelledby` rather than an `aria-label` — the heading is
            already on screen, and duplicating it as an attribute is how the two
            silently drift apart in translation. */}
        <motion.div variants={staggerItem}>
          <section className={TOWER_HERO} aria-labelledby="tower-now-title">
            <div className={SECTION_HEAD.ROOT}>
              <h2 id="tower-now-title" className={SECTION_HEAD.TITLE}>
                {t("tower_locking.live.title")}
              </h2>

              {/* The freshness stamp that used to sit here was cut per direct
                  design feedback — too verbose for what it added. The refresh
                  button, its only other occupant, stays. */}
              <div className={SECTION_HEAD.META}>
                {tower.isLoading ? (
                  <Skeleton className={SKELETON_SHAPE.SECTION_META} />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void tower.refresh()}
                      disabled={tower.isRefreshing}
                      aria-label={t("tower_locking.live.refresh")}
                      className={HERO_REFRESH_BUTTON}
                    >
                      <MaterialSymbol
                        name="refresh"
                        size={18}
                        className={
                          tower.isRefreshing
                            ? "animate-spin motion-reduce:animate-none"
                            : undefined
                        }
                      />
                    </button>
                    <span className="sr-only" aria-live="polite">
                      {tower.isRefreshing
                        ? t("tower_locking.a11y.refreshing")
                        : ""}
                    </span>
                  </>
                )}
              </div>
            </div>

            <TowerLiveStrip
              modemState={tower.modemState}
              carrierComponents={carriers}
              canTarget={canTarget}
              isLoading={tower.isLoading}
              onPickCarrier={handlePickCarrier}
            />
          </section>
        </motion.div>

        {/* --- 2. While nobody is watching -----------------------------------
            The standing orders. `TOWER_SECTION`, not a second `TOWER_HERO`:
            one anchor per surface, and it belongs to the section that leads. */}
        <motion.div variants={staggerItem}>
          <section
            className={TOWER_SECTION}
            aria-labelledby="tower-automation-title"
          >
            <div className={SECTION_HEAD.ROOT}>
              <h2
                id="tower-automation-title"
                className={SECTION_HEAD.TITLE}
              >
                {t("tower_locking.automation.title")}
              </h2>
              {/* On the title's ROW, not under it — a section header is a
                  signpost over content the reader can already see. */}
              <p className={SECTION_HEAD.DESCRIPTION}>
                {t("tower_locking.automation.description")}
              </p>
            </div>

            <TowerAutomationTiles
              config={tower.config}
              modemState={tower.modemState}
              failover={tower.failoverState}
              configPersist={tower.config?.persist ?? false}
              /* `?? null`, NEVER `?? 20`. The incumbent default rendered in the
               threshold input as a confident two-digit number that nothing on
               screen distinguished from a real setting — including while the
               error notice above said `status.sh` had failed all three retries
               and NOTHING had been read. State-Honesty Rule: a missing reading
               is an empty field, not a plausible value. */
            failoverThreshold={tower.config?.failover?.threshold ?? null}
              activeRsrp={activeRsrp}
              isLoading={tower.isLoading}
              isSavingFailover={tower.isSavingFailover}
              onTogglePersist={handlePersist}
              onToggleFailover={handleFailover}
              onThresholdChange={handleThreshold}
              onScheduleChange={tower.updateSchedule}
            />
          </section>
        </motion.div>

        {/* Nested cascade container: it inherits `visible` from its parent and
            must NOT declare its own initial/animate, or it detaches from the
            parent's clock. `h-full` on each cell so a card whose data has not
            landed matches its row-mates instead of sizing to its own content.

            The cells carried `id="tower-locking-card-<leg>"` and a `scroll-mt-20`
            until this change. Both existed for ONE caller: the retired hero
            panel's leg rows, which smooth-scrolled the matching card into view.
            With that panel gone nothing linked here, so the anchors were two ids
            referenced only by themselves and an offset correcting for a scroll
            that no longer happens. */}
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          <motion.div
            variants={staggerItem}
            className="h-full *:data-[slot=card]:h-full"
          >
            <LteTowerCard
              config={tower.config}
              modemState={tower.modemState}
              carriers={lteCarriers}
              isLoading={tower.isLoading}
              isLocking={tower.isLteLocking}
              prefill={ltePrefill}
              onLock={tower.lockLte}
              onUnlock={tower.unlockLte}
              onFreeSlotsChange={setLteFreeSlots}
            />
          </motion.div>

          <motion.div
            variants={staggerItem}
            className="h-full *:data-[slot=card]:h-full"
          >
            <NrSaTowerCard
              config={tower.config}
              modemState={tower.modemState}
              carriers={nrCarriers}
              networkType={networkType}
              servingNr={{
                arfcn: modemData?.nr?.arfcn ?? null,
                pci: modemData?.nr?.pci ?? null,
                scs: modemData?.nr?.scs ?? null,
              }}
              isLoading={tower.isLoading}
              isLocking={tower.isNrLocking}
              prefill={nrPrefill}
              onLock={tower.lockNrSa}
              onUnlock={tower.unlockNrSa}
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default TowerLockingComponent;
