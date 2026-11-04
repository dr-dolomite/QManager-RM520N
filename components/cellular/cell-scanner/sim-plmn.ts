// =============================================================================
// sim-plmn — does a scanned cell belong to the SIM in the slot?
// =============================================================================
// A lock onto another operator's cell is one the SIM cannot register on. The
// SIM's home PLMN comes from the IMSI (`device.imsi`): 3 MCC digits, then a 2-
// or 3-digit MNC whose length is fixed per MCC, so the 3-digit MCCs are listed.
// =============================================================================

/** MCCs whose operators use 3-digit MNCs. Not exhaustive: an unlisted one falls back to 2 digits. */
const THREE_DIGIT_MNC_MCCS = new Set([
  "302", "310", "311", "312", "313", "314", "315", "316", "334", "338", "342",
  "344", "346", "348", "354", "356", "358", "360", "365", "376", "708", "722",
  "732", "750",
]);

/** MCCs where operators of both MNC lengths coexist. */
const MIXED_MNC_MCCS = new Set(["405"]);

export interface SimPlmn {
  mcc: number;
  /** Every MNC the IMSI can be read as — one, or two for a mixed MCC. */
  mncs: number[];
}

/** The SIM's home PLMN, or `null` when the IMSI is absent or malformed. */
export function simPlmnFromImsi(imsi: string | null | undefined): SimPlmn | null {
  const digits = (imsi ?? "").trim();
  if (!/^\d{6,15}$/.test(digits)) return null;

  const mccStr = digits.slice(0, 3);
  const two = Number(digits.slice(3, 5));
  const three = Number(digits.slice(3, 6));

  const mncs = MIXED_MNC_MCCS.has(mccStr)
    ? [two, three]
    : THREE_DIGIT_MNC_MCCS.has(mccStr)
      ? [three]
      : [two];

  return { mcc: Number(mccStr), mncs };
}

/** Whether a cell is on the SIM's network. An unknown SIM answers `true`: the dialog still guards the lock. */
export function cellMatchesSim(
  cell: { mcc: number; mnc: number },
  sim: SimPlmn | null,
): boolean {
  if (!sim) return true;
  return cell.mcc === sim.mcc && sim.mncs.includes(cell.mnc);
}
