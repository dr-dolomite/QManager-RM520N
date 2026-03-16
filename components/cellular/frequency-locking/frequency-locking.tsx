"use client";

import LteFreqLockingComponent from "./lte-freq-locking";
import NrFreqLockingComponent from "./nr-freq-locking";
import { useFrequencyLocking } from "@/hooks/use-frequency-locking";
import { useModemStatus } from "@/hooks/use-modem-status";

const FrequencyLockingComponent = () => {
  const freqLock = useFrequencyLocking();
  const { data: modemData } = useModemStatus();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Frequency Locking</h1>
        <p className="text-muted-foreground">
          Lock to specific EARFCNs/NR-ARFCNs. Experimental — use with caution.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 grid-flow-row gap-4">
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
