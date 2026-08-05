"use client";

import { CellularPageHeader } from "@/components/cellular/page-header";
import LteFreqLockingComponent from "./lte-freq-locking";
import NrFreqLockingComponent from "./nr-freq-locking";
import { useFrequencyLocking } from "@/hooks/use-frequency-locking";
import { useModemStatus } from "@/hooks/use-modem-status";

const FrequencyLockingComponent = () => {
  const freqLock = useFrequencyLocking();
  const { data: modemData } = useModemStatus();

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      {/* Header-only migration. Band Locking, Tower Locking and Frequency
          Locking are one sub-tree a user crosses three times in a single task,
          so they share the header shape even though the cards below this one
          are not yet migrated. Copy is unchanged and still an English literal —
          converting it is its own change, not a side effect of this one. */}
      <CellularPageHeader
        title="Frequency Locking"
        description="Lock to specific EARFCNs/NR-ARFCNs. Experimental — use with caution."
      />
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <LteFreqLockingComponent
          modemState={freqLock.modemState}
          modemData={modemData}
          isLoading={freqLock.isLoading}
          isLocking={freqLock.isLteLocking}
          error={freqLock.error}
          towerLockActive={freqLock.towerLockLteActive}
          onLock={(earfcns) => freqLock.lockLte(earfcns)}
          onUnlock={() => freqLock.unlockLte()}
          onRefresh={freqLock.refresh}
        />
        <NrFreqLockingComponent
          modemState={freqLock.modemState}
          modemData={modemData}
          isLoading={freqLock.isLoading}
          isLocking={freqLock.isNrLocking}
          error={freqLock.error}
          towerLockActive={freqLock.towerLockNrActive}
          onLock={(entries) => freqLock.lockNr(entries)}
          onUnlock={() => freqLock.unlockNr()}
          onRefresh={freqLock.refresh}
        />
      </div>
    </div>
  );
};

export default FrequencyLockingComponent;
