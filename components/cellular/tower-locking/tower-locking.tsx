"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useTowerLocking } from "@/hooks/use-tower-locking";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { CarrierComponent } from "@/types/modem-status";
import type { LteLockCell, TowerActionResult } from "@/types/tower-locking";

import TowerAutomationTiles from "./automation-tiles";
import TowerLiveStrip, { type CanTarget, type TileAction } from "./live-strip";
import LteTowerCard from "./lte-tower-card";
import NrSaTowerCard from "./nr-sa-tower-card";
import { reportTowerResult, writeTowerSettings } from "./settings-write";
import { defaultScsForBand } from "./simple-mode-utils";
import {
  LEG_KEYS,
  SECTION_HEAD,
  TOWER_HERO,
  TOWER_SECTION,
  type TowerLeg,
} from "./shapes";

// =============================================================================
// TowerLockingComponent — page coordinator for /cellular/cell-locking/tower-locking
// =============================================================================
// Owns every hook and distributes data down as props; no child talks to CGI.
//
//   useModemStatus()   -> carrier_components, network type, per-leg RSRP/PCI/SCS
//   useTowerLocking()  -> config, modem lock state, failover state, writes
//
// Anatomy: header, read-failure condition, "Right now" (carriers on air), automation (acts on the whole modem), then
// 2-up leg cards. Do not re-merge the first two: each section's header describes only its own body.
//
// Tile actions lock, add to, or remove from the lock in one click. LTE re-applies the whole cell set (one modem
// command, no unlock first); the set comes from the LIVE modem state, never a leg card's unsaved draft.
// =============================================================================

const K = "tower_locking";

const TowerLockingComponent = () => {
  const { t } = useTranslation("cellular");
  const { data: modemData } = useModemStatus();
  const tower = useTowerLocking();

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

  // Which legs can take a lock from a tile, and why not (shown on the control, not hidden). Removing a lock is never
  // gated.
  const lteHeld = tower.modemState?.lte_locked
    ? (tower.modemState.lte_cells ?? [])
    : [];
  const canTarget: Record<TowerLeg, CanTarget> = useMemo(() => {
    const nrReason =
      networkType === "5G-NSA"
        ? t(`${K}.live.tile_blocked_nsa`)
        : networkType === "LTE" || networkType === ""
          ? t(`${K}.live.tile_blocked_lte_only`)
          : null;
    return {
      lte:
        lteHeld.length < 3
          ? { ok: true, reason: null }
          : { ok: false, reason: t(`${K}.live.tile_blocked_slots_full`) },
      nr_sa: nrReason ? { ok: false, reason: nrReason } : { ok: true, reason: null },
    };
  }, [networkType, lteHeld.length, t]);

  const report = (
    result: TowerActionResult,
    success: string,
    fallback: string,
  ) => {
    reportTowerResult(t, result, success, fallback);
  };

  // One radio's "Keep after reboot"; the other radio is left as the modem has it.
  const handleSetPersist = (leg: TowerLeg, on: boolean) => {
    const legName = t(LEG_KEYS[leg].short);
    void writeTowerSettings(
      t,
      tower.updateSettings,
      leg === "lte" ? { persist_lte: on } : { persist_nr: on },
      on
        ? t(`${K}.toast.persist_enabled`, { leg: legName })
        : t(`${K}.toast.persist_disabled`, { leg: legName }),
    );
  };

  // One click on a tile's button. The result is the toast.
  const handleActCarrier = async (c: CarrierComponent, action: TileAction) => {
    if (c.earfcn === null || c.pci === null) return;
    const leg: TowerLeg = c.technology === "LTE" ? "lte" : "nr_sa";
    const legName = t(LEG_KEYS[leg].short);

    if (leg === "lte") {
      const here: LteLockCell = { earfcn: c.earfcn, pci: c.pci };
      const others = lteHeld.filter(
        (cell) => !(cell.earfcn === here.earfcn && cell.pci === here.pci),
      );
      if (action === "unlock") {
        // The last cell going means no lock at all, not a lock on nothing.
        const result =
          others.length === 0
            ? await tower.unlockLte()
            : await tower.lockLte(others);
        report(
          result,
          others.length === 0
            ? t(`${K}.toast.unlocked`, { leg: legName })
            : t(`${K}.toast.cell_removed`, { leg: legName }),
          t(`${K}.errors.unlock_failed`),
        );
        return;
      }
      // Already on the list (held by the modem or saved in the config): do
      // nothing and say so, rather than rewrite the lock for no change.
      if (action === "add") {
        const listed = [...lteHeld, ...(tower.config?.lte?.cells ?? [])].some(
          (cell) => cell?.earfcn === here.earfcn && cell?.pci === here.pci,
        );
        if (listed) {
          toast.info(t(`${K}.toast.cell_exists`), { id: "tower-cell-exists" });
          return;
        }
      }
      const result = await tower.lockLte(
        action === "add" ? [...others, here] : [here],
      );
      report(
        result,
        action === "add"
          ? t(`${K}.toast.cell_added`, { leg: legName })
          : t(`${K}.toast.locked`, { leg: legName }),
        t(`${K}.errors.lock_failed`),
      );
      return;
    }

    if (action === "unlock") {
      report(
        await tower.unlockNrSa(),
        t(`${K}.toast.unlocked`, { leg: legName }),
        t(`${K}.errors.unlock_failed`),
      );
      return;
    }
    // `carrier_components` has no SCS, so a pick on the serving cell takes the
    // serving SCS and any other cell takes the band default.
    const bandNumber = Number.parseInt(
      String(c.band).replace(/[^0-9]/g, ""),
      10,
    );
    const servingScs = modemData?.nr?.scs ?? null;
    const isServing =
      modemData?.nr?.arfcn === c.earfcn && modemData?.nr?.pci === c.pci;
    const scs =
      isServing && servingScs !== null
        ? servingScs
        : (defaultScsForBand(bandNumber) ?? 30);
    report(
      await tower.lockNrSa({
        pci: c.pci,
        arfcn: c.earfcn,
        scs,
        band: Number.isNaN(bandNumber) ? 0 : bandNumber,
      }),
      t(`${K}.toast.locked`, { leg: legName }),
      t(`${K}.errors.lock_failed`),
    );
  };

  // The RSRP of whichever leg the modem is actually registered on.
  const activeRsrp =
    networkType === "5G-SA"
      ? (modemData?.nr?.rsrp ?? null)
      : (modemData?.lte?.rsrp ?? null);

  // A read mid-write would race the AT lock the write holds.
  const isWriting =
    tower.isLteLocking || tower.isNrLocking || tower.isSavingSettings;
  const isRefreshBlocked = isWriting || tower.isRefreshing || tower.isLoading;

  // A refresh belongs to no card, so its failure is a toast; success is
  // evident from the page updating.
  const handleRefresh = async () => {
    const ok = await tower.refresh();
    if (!ok) toast.error(t(`${K}.toast.refresh_error`));
  };

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
        actions={
          <>
            {/* The scanner is where a target comes from when it is not a cell
                the modem is camped on. Navigates, so tonal and not default. */}
            <Button asChild variant="tonal" size="action">
              <Link href="/cellular/cell-scanner">
                <MaterialSymbol name="radar" size={18} />
                {t("radio_info.bands.scanner.link")}
              </Link>
            </Button>
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={handleRefresh}
              disabled={isRefreshBlocked}
            >
              <MaterialSymbol
                name="refresh"
                size={18}
                className={
                  tower.isRefreshing ? "motion-safe:animate-spin" : undefined
                }
              />
              {t(`${K}.actions.refresh`)}
            </Button>
          </>
        }
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {tower.isRefreshing ? t(`${K}.a11y.refreshing`) : ""}
      </div>

      {/* A failed read keeps the previous figures on screen, so this is the
          only thing saying they are not the modem's. */}
      {tower.readError && !tower.isLoading ? (
        <ConditionScreen
          tone="destructive"
          glyph="visibility_off"
          ariaRole="alert"
          title={t(`${K}.error.title`)}
          description={tower.readError}
          onRetry={handleRefresh}
          retryLabel={t(`${K}.error.retry`)}
          disabled={isRefreshBlocked}
          disabledReason={
            isWriting ? t(`${K}.blocked.refresh_writing`) : undefined
          }
        />
      ) : null}

      <motion.div
        className="flex flex-col gap-5"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <Card className={TOWER_HERO} aria-labelledby="tower-now-title">
            <div className={SECTION_HEAD.ROOT}>
              <CardTitle as="h2" id="tower-now-title" className={SECTION_HEAD.TITLE}>
                {t(`${K}.live.title`)}
              </CardTitle>
            </div>
            <TowerLiveStrip
              modemState={tower.modemState}
              carrierComponents={carriers}
              canTarget={canTarget}
              isLoading={tower.isLoading}
              busy={{ lte: tower.isLteLocking, nr_sa: tower.isNrLocking }}
              onActCarrier={handleActCarrier}
            />
          </Card>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Card
            className={TOWER_SECTION}
            aria-labelledby="tower-automation-title"
          >
            <div className={SECTION_HEAD.ROOT}>
              <CardTitle as="h2" id="tower-automation-title" className={SECTION_HEAD.TITLE}>
                {t(`${K}.automation.title`)}
              </CardTitle>
              <CardDescription className={SECTION_HEAD.DESCRIPTION}>
                {t(`${K}.automation.description`)}
              </CardDescription>
            </div>
            <TowerAutomationTiles
              config={tower.config}
              modemState={tower.modemState}
              failover={tower.failoverState}
              activeRsrp={activeRsrp}
              isLoading={tower.isLoading}
              isSavingSettings={tower.isSavingSettings}
              onUpdateSettings={tower.updateSettings}
              onScheduleChange={tower.updateSchedule}
            />
          </Card>
        </motion.div>

        {/* Nested cascade: inherits `visible` from the parent. `h-full` on each
            cell so a card still loading matches its row-mate. */}
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
              onLock={tower.lockLte}
              onUnlock={tower.unlockLte}
              isSavingSettings={tower.isSavingSettings}
              onSetPersist={(on) => handleSetPersist("lte", on)}
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
              onLock={tower.lockNrSa}
              onUnlock={tower.unlockNrSa}
              isSavingSettings={tower.isSavingSettings}
              onSetPersist={(on) => handleSetPersist("nr_sa", on)}
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default TowerLockingComponent;
