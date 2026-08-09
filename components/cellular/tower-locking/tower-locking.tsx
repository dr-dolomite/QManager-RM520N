"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useTowerLocking } from "@/hooks/use-tower-locking";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { CarrierComponent } from "@/types/modem-status";
import type { LteLockCell, NrSaLockCell } from "@/types/tower-locking";

import LteTowerCard from "./lte-tower-card";
import NrSaTowerCard from "./nr-sa-tower-card";
import ScheduleCard from "./schedule-card";
import TowerLockHero from "./tower-lock-hero";
import { defaultScsForBand } from "./simple-mode-utils";
import {
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION,
  TOWER_CARD,
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
// A page header, then one hero, then a grid of peer cards — the same shape as
// Band Locking, and the same shape as every other feature page in this product.
// The incumbent put a read-only status card and three control surfaces into a
// single 2x2 grid, which said all four were the same kind of object. The hero
// reports what the modem IS doing; the cards change what it WILL do.
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
          <div>
            <Button
              type="button"
              onClick={() => void tower.refresh()}
              disabled={tower.isRefreshing}
              className={PILL_ACTION}
            >
              <MaterialSymbol name="refresh" size={18} />
              {t("tower_locking.error.retry")}
            </Button>
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
        <motion.div variants={staggerItem}>
          <TowerLockHero
            modemState={tower.modemState}
            failover={tower.failoverState}
            configPersist={tower.config?.persist ?? false}
            failoverThreshold={tower.config?.failover?.threshold ?? 20}
            carrierComponents={carriers}
            activeRsrp={activeRsrp}
            canTarget={canTarget}
            isLoading={tower.isLoading}
            isRefreshing={tower.isRefreshing}
            isSavingFailover={tower.isSavingFailover}
            lastSyncedAt={tower.lastSyncedAt}
            onPickCarrier={handlePickCarrier}
            onTogglePersist={handlePersist}
            onToggleFailover={handleFailover}
            onThresholdChange={handleThreshold}
            onRefresh={() => void tower.refresh()}
          />
        </motion.div>

        {/* Nested cascade container: it inherits `visible` from its parent and
            must NOT declare its own initial/animate, or it detaches from the
            parent's clock. `h-full` on each cell so a card whose data has not
            landed matches its row-mates instead of sizing to its own content. */}
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          <motion.div
            id="tower-locking-card-lte"
            variants={staggerItem}
            // `scroll-mt` so a smooth-scroll from a hero rail row lands the card
            // below the sticky shell header instead of under it.
            className="h-full scroll-mt-20 *:data-[slot=card]:h-full"
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
            id="tower-locking-card-nr_sa"
            variants={staggerItem}
            className="h-full scroll-mt-20 *:data-[slot=card]:h-full"
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

          <motion.div
            variants={staggerItem}
            className="h-full *:data-[slot=card]:h-full"
          >
            <ScheduleCard
              config={tower.config}
              isLoading={tower.isLoading}
              onScheduleChange={tower.updateSchedule}
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default TowerLockingComponent;
