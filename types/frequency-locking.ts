// =============================================================================
// frequency-locking.ts — QManager Frequency Locking Types
// =============================================================================
// TypeScript interfaces for the Frequency Locking feature (Experimental).
// Frequency locking controls which EARFCNs (frequencies) the modem may use,
// independent of tower locking (which controls specific PCI+EARFCN combos).
//
// IMPORTANT: This feature is mutually exclusive with Tower Lock.
// The NR5G AT command doc explicitly states: "This command cannot be used
// together with AT+QNWLOCK='common/5g'."
//
// Backend contract:
//   Status:      GET  /cgi-bin/quecmanager/frequency/status.sh
//   Lock/Unlock: POST /cgi-bin/quecmanager/frequency/lock.sh
// =============================================================================

// --- LTE Frequency Lock Target -----------------------------------------------

/** A single LTE EARFCN for frequency locking (no PCI, no SCS) */
export interface LteFreqLockEntry {
  earfcn: number;
}

// --- NR5G Frequency Lock Target ----------------------------------------------

/** A single NR5G EARFCN+SCS pair for frequency locking */
export interface NrFreqLockEntry {
  arfcn: number;
  scs: number; // kHz: 15, 30, 60, 120, 240
}

// --- Modem State (from AT+QNWCFG queries) ------------------------------------

/** Live frequency lock state queried from AT+QNWCFG commands */
export interface FreqLockModemState {
  lte_locked: boolean;
  lte_entries: LteFreqLockEntry[]; // 0-2 entries
  nr_locked: boolean;
  nr_entries: NrFreqLockEntry[]; // 0-32 entries
  tower_lock_lte_active: boolean; // From AT+QNWLOCK="common/4g"
  tower_lock_nr_active: boolean; // From AT+QNWLOCK="common/5g"

  /**
   * DID THE TOWER-LOCK PROBE ACTUALLY COME BACK?
   *
   * `status.sh:109` seeds `tower_lock_*_read_ok="true"` and flips it to false
   * when the `AT+QNWLOCK` read errors — at which point `tower_lock_*_active`
   * keeps its `false` seed and is indistinguishable from a genuine "no tower
   * lock". That mattered because `frequency/lock.sh:81` REFUSES the write in
   * exactly this case (`tower_lock_unknown`): the page would leave Lock enabled,
   * take the user through the form and an AT round-trip, and only then refuse —
   * the pattern `blockedReason` exists to eliminate.
   *
   * OPTIONAL, AND ABSENT MEANS TRUE, matching `TowerModemState`: a statically
   * exported bundle can outlive the CGI it talks to, so every consumer tests
   * `=== false` and nothing else. `!== true` would block the whole page the
   * moment the two halves fall out of step.
   */
  tower_lock_lte_read_ok?: boolean;
  tower_lock_nr_read_ok?: boolean;
}

// --- API Responses -----------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/frequency/status.sh */
export interface FreqLockStatusResponse {
  success: boolean;
  modem_state: FreqLockModemState;
  error?: string;
}

/** Response from POST /cgi-bin/quecmanager/frequency/lock.sh */
export interface FreqLockResponse {
  success: boolean;
  type?: string; // "lte" or "nr"
  action?: string; // "lock" or "unlock"
  count?: number;
  error?: string;
  detail?: string;
}
