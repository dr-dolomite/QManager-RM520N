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
  /**
   * From AT+QNWLOCK="common/4g".
   *
   * TRI-STATE. `null` means `status.sh` could not read the tower lock state at
   * all, which is NOT the same fact as "no tower lock is active". Stacking a
   * frequency lock on a live tower lock can crash-dump the modem
   * (`frequency/lock.sh` header), so an unreadable state is treated as
   * BLOCKING everywhere it gates a write. It must never be rendered as a claim
   * that a tower lock IS active - the page has to say it does not know.
   */
  tower_lock_lte_active: boolean | null;
  /** From AT+QNWLOCK="common/5g". `null` means the read failed and blocks
   *  writes, exactly as for the LTE leg above. */
  tower_lock_nr_active: boolean | null;
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
