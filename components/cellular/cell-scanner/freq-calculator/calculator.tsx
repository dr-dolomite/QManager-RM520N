"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { X, Trash2 } from "lucide-react";
import {
  type LTEBandEntry,
  type NRBandEntry,
  LTE_BANDS,
  NR_BANDS,
  findAllMatchingLTEBands,
  findAllMatchingNRBands,
  lteDLFrequency,
  lteULFrequency,
  nrArfcnToFrequency,
  nrULFrequency,
} from "@/lib/earfcn";

// --- Auto-detection boundaries (derived from shared band tables) -------------
const MAX_LTE_EARFCN = Math.max(...LTE_BANDS.map((b) => b.earfcnRange[1]));
const MIN_NR_ARFCN = Math.min(...NR_BANDS.map((b) => b.nrarfcnRange[0]));

// --- Types -------------------------------------------------------------------

type LTEMatchingBand = LTEBandEntry & {
  dlFrequency: string;
  ulFrequency: string;
  ulEarfcn: number;
  dlHigh: number;
  ulHigh: number;
};

type NRMatchingBand = NRBandEntry & {
  dlFrequency: string;
  ulFrequency: string;
  dlHigh: number;
  ulHigh: number;
};

type LTEResult = {
  networkType: "LTE";
  earfcn: number;
  frequency: string;
  possibleBands: LTEMatchingBand[];
};

type NRResult = {
  networkType: "NR";
  earfcn: number;
  frequency: string;
  possibleBands: NRMatchingBand[];
};

type CalculationResult = LTEResult | NRResult | null;

type ErrorResult = {
  error: string;
};

type HistoryEntry = {
  networkType: "LTE" | "NR";
  earfcn: number;
  frequency: string;
  possibleBands: (LTEMatchingBand | NRMatchingBand)[];
  timestamp: string;
  id: string;
};

// --- Calculation functions using shared library --------------------------------

const calculateLTEFrequency = (earfcn: number): LTEResult | null => {
  const bands = findAllMatchingLTEBands(earfcn);
  if (bands.length === 0) return null;

  const matchingBands: LTEMatchingBand[] = bands.map((band) => {
    const dlFreq = lteDLFrequency(earfcn) ?? 0;
    const ulFreq = lteULFrequency(earfcn);
    const ulEarfcn = band.duplexType === "FDD" ? earfcn + 18000 : earfcn;

    // Compute band high edges from EARFCN range
    const rangeSpan = (band.earfcnRange[1] - band.earfcnOffset) * band.spacing;
    const dlHigh = Math.round((band.dlLow + rangeSpan) * 10) / 10;
    const ulHigh =
      band.duplexType === "SDL"
        ? 0
        : band.duplexType === "TDD"
          ? dlHigh
          : Math.round((band.ulLow + rangeSpan) * 10) / 10;

    return {
      ...band,
      dlFrequency: dlFreq.toFixed(2),
      ulFrequency: ulFreq !== null ? ulFreq.toFixed(2) : "-",
      ulEarfcn,
      dlHigh,
      ulHigh,
    };
  });

  return {
    networkType: "LTE",
    earfcn,
    frequency: matchingBands[0].dlFrequency,
    possibleBands: matchingBands,
  };
};

const calculateNRFrequency = (nrarfcn: number): NRResult | null => {
  const frequency = nrArfcnToFrequency(nrarfcn);
  if (frequency === null) return null;

  const bands = findAllMatchingNRBands(nrarfcn);
  if (bands.length === 0) return null;

  const matchingBands: NRMatchingBand[] = bands.map((band) => {
    const dlFreq = frequency;
    const ulFreq = nrULFrequency(nrarfcn, band.band);

    // Compute high edges from NR-ARFCN range
    const dlHigh = nrArfcnToFrequency(band.nrarfcnRange[1]) ?? band.dlLow;
    const bandwidth = dlHigh - band.dlLow;
    const ulHigh =
      band.duplexType === "SDL"
        ? 0
        : band.duplexType === "TDD"
          ? dlHigh
          : band.ulLow + bandwidth;

    return {
      ...band,
      dlFrequency: dlFreq.toFixed(2),
      ulFrequency: ulFreq !== null ? ulFreq.toFixed(2) : "-",
      dlHigh: Math.round(dlHigh * 100) / 100,
      ulHigh: Math.round(ulHigh * 100) / 100,
    };
  });

  return {
    networkType: "NR",
    earfcn: nrarfcn,
    frequency: frequency.toFixed(2),
    possibleBands: matchingBands,
  };
};

// Decide which calculation to use based on the EARFCN/NR-ARFCN range
const calculateFrequency = (
  earfcn: string,
  forceType: "lte" | "nr" | null = null
): CalculationResult | ErrorResult => {
  const earfcnNum = parseInt(earfcn);

  if (isNaN(earfcnNum)) {
    return { error: "Please enter a valid number" };
  }

  if (
    forceType === "lte" ||
    (forceType === null && earfcnNum >= 0 && earfcnNum <= MAX_LTE_EARFCN)
  ) {
    return calculateLTEFrequency(earfcnNum);
  } else if (
    forceType === "nr" ||
    (forceType === null && earfcnNum >= MIN_NR_ARFCN)
  ) {
    return calculateNRFrequency(earfcnNum);
  }

  return null;
};

// Initialize history from localStorage
const getInitialHistory = (): HistoryEntry[] => {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const savedHistory = localStorage.getItem("earfcnHistory");
      if (savedHistory) {
        return JSON.parse(savedHistory) as HistoryEntry[];
      }
    } catch {
      // Silently fail
    }
  }
  return [];
};

const FrequencyCalculator = () => {
  const [earfcn, setEarfcn] = useState<string>("");
  const [result, setResult] = useState<CalculationResult>(null);
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"auto" | "lte" | "nr">("auto");
  const [history, setHistory] = useState<HistoryEntry[]>(getInitialHistory);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        if (history.length > 0) {
          localStorage.setItem("earfcnHistory", JSON.stringify(history));
        } else {
          localStorage.removeItem("earfcnHistory");
        }
      } catch {
        // Silently fail
      }
    }
  }, [history]);

  const handleCalculate = (): void => {
    if (!earfcn) {
      setError("Please enter an E/ARFCN value");
      setResult(null);
      return;
    }

    try {
      const forceType = activeTab === "auto" ? null : activeTab;
      const calculationResult = calculateFrequency(earfcn, forceType);

      if (calculationResult && !("error" in calculationResult)) {
        setResult(calculationResult);
        setError("");

        const historyEntry: HistoryEntry = {
          ...calculationResult,
          timestamp: new Date().toISOString(),
          id: Date.now().toString(),
        };

        setHistory((prev) => [historyEntry, ...prev.slice(0, 9)]);
      } else if (calculationResult && "error" in calculationResult) {
        setError(calculationResult.error);
        setResult(null);
      } else {
        setError("Could not identify band for this E/ARFCN value");
        setResult(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError("Calculation error: " + errorMessage);
      setResult(null);
    }
  };

  const deleteHistoryEntry = (id: string): void => {
    setHistory((prev) => prev.filter((entry) => entry.id !== id));
  };

  const clearHistory = (): void => {
    setHistory([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCalculate();
    }
  };

  return (
    <div className="grid gap-4 @xl/main:grid-cols-2">
      {/* Calculator Card */}
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>E/ARFCN Calculator</CardTitle>
          <CardDescription>
            Enter a channel number to calculate frequency and band information.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            defaultValue="auto"
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "auto" | "lte" | "nr")
            }
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="auto">Auto</TabsTrigger>
              <TabsTrigger value="lte">LTE</TabsTrigger>
              <TabsTrigger value="nr">NR</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="earfcn">
              {activeTab === "lte"
                ? "E-ARFCN"
                : activeTab === "nr"
                ? "NR-ARFCN"
                : "E/ARFCN Value"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="earfcn"
                type="number"
                placeholder="Enter channel number"
                value={earfcn}
                onChange={(e) => setEarfcn(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button onClick={handleCalculate}>Calculate</Button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 text-red-500 border border-red-300/50 rounded-md text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <Separator />
              <div className="space-y-3">
                <h3 className="font-semibold">Result</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground font-semibold">Network Type</div>
                  <div className="font-medium">
                    <Badge variant="default">{result.networkType}</Badge>
                  </div>

                  <div className="text-muted-foreground font-semibold">
                    {result.networkType === "LTE" ? "EARFCN" : "NR-ARFCN"}
                  </div>
                  <div className="font-medium">{result.earfcn}</div>

                  <div className="text-muted-foreground font-semibold">Frequency</div>
                  <div className="font-medium">{result.frequency} MHz</div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-semibold">Possible Operating Bands</h4>
                <div className="space-y-4">
                  {result.possibleBands.map((band, index) => (
                    <div key={index} className="space-y-2">
                      {index > 0 && <Separator />}
                      <div className="font-semibold">
                        {result.networkType === "NR"
                          ? `n${band.band}`
                          : `Band ${band.band}`}{" "}
                        <span className="font-semibold text-sm">
                          ({band.name})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-sm">
                        <div className="text-muted-foreground font-semibold">Duplex Mode</div>
                        <div className="font-medium">{band.duplexType}</div>

                        <div className="text-muted-foreground font-semibold">
                          Downlink Range
                        </div>
                        <div className="font-medium">
                          {band.dlLow} - {band.dlHigh} MHz
                        </div>

                        {band.duplexType === "FDD" && (
                          <>
                            <div className="text-muted-foreground font-semibold">
                              Uplink Range
                            </div>
                            <div className="font-medium">
                              {band.ulLow} - {band.ulHigh} MHz
                            </div>
                          </>
                        )}

                        <div className="text-muted-foreground font-semibold">
                          {result.networkType === "LTE"
                            ? "EARFCN Range"
                            : "NR-ARFCN Range"}
                        </div>
                        <div className="font-medium">
                          {"earfcnRange" in band
                            ? `${band.earfcnRange[0]} - ${band.earfcnRange[1]}`
                            : `${(band as NRMatchingBand).nrarfcnRange[0]} - ${(band as NRMatchingBand).nrarfcnRange[1]}`}
                        </div>

                        <div className="text-muted-foreground font-semibold">
                          DL Frequency
                        </div>
                        <div className="font-medium">
                          {band.dlFrequency} MHz
                        </div>

                        {band.duplexType !== "SDL" && (
                          <>
                            <div className="text-muted-foreground font-semibold">
                              UL Frequency
                            </div>
                            <div className="font-medium">
                              {band.ulFrequency} MHz
                            </div>
                          </>
                        )}

                        {band.duplexType === "SDL" && (
                          <>
                            <div className="text-muted-foreground font-semibold">
                              UL Frequency
                            </div>
                            <div className="font-medium text-muted-foreground">
                              Downlink Only
                            </div>
                          </>
                        )}

                        {"earfcnRange" in band &&
                          band.duplexType === "FDD" && (
                            <>
                              <div className="text-muted-foreground font-semibold">
                                UL EARFCN
                              </div>
                              <div className="font-medium">
                                {(band as LTEMatchingBand).ulEarfcn}
                              </div>
                            </>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Calculation method:{" "}
                {result.networkType === "NR"
                  ? "3GPP TS 38.104 Section 5.4.2.1"
                  : "3GPP TS 36.101 Section 5.7"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History Card */}
      <Card className="@container/card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Calculation History</CardTitle>
              <CardDescription>
                Your recent calculations are saved locally.
              </CardDescription>
            </div>
            {history.length > 0 && (
              <Button variant="destructive" size="sm" onClick={clearHistory}>
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No calculation history yet.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 border rounded-lg flex justify-between items-start"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{entry.earfcn}</span>
                      <Badge>{entry.networkType}</Badge>
                      <span className="text-sm font-medium text-muted-foreground">
                        {entry.frequency} MHz
                      </span>
                    </div>
                    {entry.possibleBands && (
                      <div className="text-sm font-semibold">
                        Bands:{" "}
                        {entry.possibleBands
                          .map((band) =>
                            entry.networkType === "NR"
                              ? `n${band.band}`
                              : `B${band.band}`
                          )
                          .join(", ")}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : "No timestamp"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryEntry(entry.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FrequencyCalculator;
