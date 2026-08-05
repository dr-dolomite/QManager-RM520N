"use client";

import React from "react";
import { toast } from "sonner";
import { CellularPageHeader } from "@/components/cellular/page-header";
import TowerLockingSettingsComponent from "@/components/cellular/tower-locking/tower-settings";
import ScheduleTowerLockingComponent from "./schedule-locking";
import LTELockingComponent from "./lte-locking";
import NRSALockingComponent from "./nr-sa-locking";
import { useTowerLocking } from "@/hooks/use-tower-locking";
import { useModemStatus } from "@/hooks/use-modem-status";

const TowerLockingComponent = () => {
  const tower = useTowerLocking();
  const { data: modemData } = useModemStatus();

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      {/* Header-only migration — see the note in `frequency-locking.tsx`. The
          three cell-locking routes share a header shape so the sub-tree does
          not read as three different products. */}
      <CellularPageHeader
        title="Tower Locking"
        description="Lock onto specific cell towers by PCI and EARFCN."
      />
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
          <TowerLockingSettingsComponent
            config={tower.config}
            failoverState={tower.failoverState}
            modemData={modemData}
            isLoading={tower.isLoading}
            onPersistChange={(persist) => {
              if (!tower.config) {
                toast.error("Settings unavailable — try refreshing the page");
                return;
              }
              tower.updateSettings(persist, tower.config.failover);
            }}
            onFailoverChange={async (enabled) => {
              if (!tower.config) {
                toast.error("Settings unavailable — try refreshing the page");
                return false;
              }
              return tower.updateSettings(tower.config.persist, {
                ...tower.config.failover,
                enabled,
              });
            }}
            isFailoverSaving={tower.isSavingFailover}
            onThresholdChange={async (threshold) => {
              if (!tower.config) {
                toast.error("Settings unavailable — try refreshing the page");
                return false;
              }
              return tower.updateSettings(tower.config.persist, {
                ...tower.config.failover,
                threshold,
              });
            }}
          />
          <LTELockingComponent
            config={tower.config}
            modemState={tower.modemState}
            modemData={modemData}
            isLoading={tower.isLoading}
            isLocking={tower.isLteLocking}
            isWatcherRunning={tower.isWatcherRunning}
            onLock={(cells) => tower.lockLte(cells)}
            onUnlock={() => tower.unlockLte()}
          />
        </div>

        <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
          <ScheduleTowerLockingComponent
            config={tower.config}
            onScheduleChange={(schedule) => tower.updateSchedule(schedule)}
          />
          <NRSALockingComponent
            config={tower.config}
            modemState={tower.modemState}
            modemData={modemData}
            networkType={modemData?.network?.type ?? ""}
            isLoading={tower.isLoading}
            isLocking={tower.isNrLocking}
            isWatcherRunning={tower.isWatcherRunning}
            onLock={(cell) => tower.lockNrSa(cell)}
            onUnlock={() => tower.unlockNrSa()}
          />
        </div>
      </div>
    </div>
  );
};

export default TowerLockingComponent;
