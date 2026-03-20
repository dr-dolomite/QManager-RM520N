"use client";

import { useCallback, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ScannerEmptyView from "./empty-view";
import ScanResultView from "./scan-result";
import type { CellScanResult } from "./scan-result";
import { Button } from "@/components/ui/button";
import { DownloadIcon, LoaderCircleIcon, RefreshCcwIcon } from "lucide-react";
import { useCellScanner } from "@/hooks/use-cell-scanner";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { downloadCSV } from "@/lib/download-csv";
import { ScanningView } from "./scanning-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// --- CSV row builder for cell scan results -----------------------------------
function buildCsvRows(results: CellScanResult[]): string[] {
  return results.map((r) =>
    [
      r.networkType,
      `"${(r.provider || "").replace(/"/g, '""')}"`,
      r.mcc,
      r.mnc,
      r.band,
      r.earfcn,
      r.pci,
      r.cellID,
      r.tac,
      r.bandwidth,
      r.signalStrength,
    ].join(","),
  );
}

const CELL_SCAN_CSV_HEADER =
  "Network,Provider,MCC,MNC,Band,EARFCN,PCI,Cell ID,TAC,Bandwidth,Signal (dBm)";

const FullScannerComponent = () => {
  const { status, results, error, elapsedSeconds, startScan } = useCellScanner();
  const [lockTarget, setLockTarget] = useState<CellScanResult | null>(null);
  const [isLocking, setIsLocking] = useState(false);

  const hasScanResults = status === "complete" && results.length > 0;
  const isScanning = status === "running";

  // --- Lock Cell Handler ---------------------------------------------------
  // Routes through the existing tower/lock.sh for full UCI config + failover
  const handleLockCell = useCallback((cell: CellScanResult) => {
    setLockTarget(cell);
  }, []);

  const confirmLockCell = useCallback(async () => {
    if (!lockTarget) return;
    setIsLocking(true);

    try {
      // Build payload matching existing tower/lock.sh format
      let body: Record<string, unknown>;

      if (lockTarget.networkType === "NR5G") {
        body = {
          type: "nr_sa",
          action: "lock",
          pci: lockTarget.pci,
          arfcn: lockTarget.earfcn,
          scs: lockTarget.scs ?? 30, // Default SCS 30kHz if missing
          band: lockTarget.band,
        };
      } else {
        // LTE (default)
        body = {
          type: "lte",
          action: "lock",
          cells: [{ earfcn: lockTarget.earfcn, pci: lockTarget.pci }],
        };
      }

      const res = await authFetch("/cgi-bin/quecmanager/tower/lock.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success) {
        toast.success("Cell Locked", {
          description: `Locked to ${lockTarget.networkType} PCI ${lockTarget.pci} on EARFCN ${lockTarget.earfcn}`,
        });
      } else {
        toast.error("Lock Failed", {
          description: data.detail || data.error || "Unknown error",
        });
      }
    } catch {
      toast.error("Lock Failed", {
        description: "Failed to connect to modem",
      });
    } finally {
      setIsLocking(false);
      setLockTarget(null);
    }
  }, [lockTarget]);

  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cell Scanner</CardTitle>
              <CardDescription>
                Scan and display available cellular networks and towers.
              </CardDescription>
            </div>
            {isScanning && (
              <Badge
                variant="outline"
                className="text-primary border-primary/50"
              >
                <LoaderCircleIcon className="h-3 w-3 animate-spin" />
                Scanning...
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {hasScanResults ? (
              <ScanResultView data={results} onLockCell={handleLockCell} />
            ) : isScanning ? (
              <ScanningView elapsedSeconds={elapsedSeconds} />
            ) : status === "error" ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <p className="text-destructive text-sm">
                  {error || "Scan failed"}
                </p>
                <Button onClick={startScan} variant="outline" size="sm">
                  <RefreshCcwIcon className="size-4" />
                  Retry
                </Button>
              </div>
            ) : (
              <ScannerEmptyView onStartScan={startScan} />
            )}
          </div>
          {(hasScanResults || isScanning) && (
            <div className="mt-4 flex items-center gap-x-2">
              <Button onClick={startScan} disabled={isScanning}>
                {isScanning ? (
                  <>
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  "Start New Scan"
                )}
              </Button>
              {hasScanResults && (
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      CELL_SCAN_CSV_HEADER,
                      buildCsvRows(results),
                      `cell_scan_${new Date().toISOString().slice(0, 10)}.csv`,
                    )
                  }
                  aria-label="Download CSV"
                >
                  <DownloadIcon />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lock confirmation dialog */}
      <AlertDialog
        open={!!lockTarget}
        onOpenChange={(open) => !open && setLockTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock to Cell?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock the modem to the following cell. The modem will
              only connect to this specific cell until the lock is removed.
              {lockTarget && (
                <span className="mt-2 block font-mono text-xs">
                  {lockTarget.networkType} — PCI {lockTarget.pci}, EARFCN{" "}
                  {lockTarget.earfcn}, Band {lockTarget.band}
                  {lockTarget.provider && ` (${lockTarget.provider})`}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLocking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLockCell} disabled={isLocking}>
              {isLocking ? (
                <>
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  Locking...
                </>
              ) : (
                "Lock Cell"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default FullScannerComponent;
