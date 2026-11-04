#!/bin/sh
# =============================================================================
# debug_poller_at.sh — Dump raw AT command responses used by the poller
# =============================================================================
# Run on the device via SSH:
#   sh /tmp/debug_poller_at.sh > /tmp/poller_debug.txt 2>&1
#
# Then retrieve:
#   cat /tmp/poller_debug.txt
# =============================================================================

OUTPUT="/tmp/poller_debug.txt"

separator() {
    printf '\n%s\n' "========================================================================"
    printf '  %s\n' "$1"
    printf '%s\n\n' "========================================================================"
}

# --- Tier 1: Hot (every 2s) ---

separator "TIER 1 — AT+QENG=\"servingcell\" (serving cell info)"
qcmd 'AT+QENG="servingcell"' 2>/dev/null

separator "TIER 1 — AT+QRSRP (per-antenna RSRP)"
qcmd 'AT+QRSRP' 2>/dev/null

separator "TIER 1 — AT+QRSRQ (per-antenna RSRQ)"
qcmd 'AT+QRSRQ' 2>/dev/null

separator "TIER 1 — AT+QSINR (per-antenna SINR)"
qcmd 'AT+QSINR' 2>/dev/null

separator "TIER 1 — Combined: AT+QRSRP;+QRSRQ;+QSINR"
qcmd 'AT+QRSRP;+QRSRQ;+QSINR' 2>/dev/null

# --- Tier 2: Warm (every 30s) ---
# These sections mirror the actual poller command groups.

separator "TIER 2 — AT+QCAINFO (enable + query)"
qcmd 'AT+QCAINFO=1' >/dev/null 2>&1
sleep 1
qcmd 'AT+QCAINFO' 2>/dev/null

separator "TIER 2 — Group 1: AT+CGCONTRDP;+QMAP=\"WWAN\" (APN + WAN IPs)"
qcmd 'AT+CGCONTRDP;+QMAP="WWAN"' 2>/dev/null

separator "TIER 2 — Group 2: NR timing + MIMO"
qcmd 'AT+QNWCFG="nr5g_time_advance";+QNWCFG="nr5g_mimo_layers"' 2>/dev/null

separator "TIER 2 — Group 3: LTE timing + MIMO"
qcmd 'AT+QNWCFG="lte_time_advance";+QNWCFG="lte_mimo_layers"' 2>/dev/null

# --- Tier 3: Cold (every 60s) ---

separator "TIER 3 — AT+QTEMP (modem temperature)"
qcmd 'AT+QTEMP' 2>/dev/null

separator "TIER 3 — AT+COPS? (operator info)"
qcmd 'AT+COPS?' 2>/dev/null

separator "TIER 3 — AT+QUIMSLOT? (active SIM slot)"
qcmd 'AT+QUIMSLOT?' 2>/dev/null

separator "TIER 3 — AT+CPIN? (SIM status)"
qcmd 'AT+CPIN?' 2>/dev/null

# --- Boot data ---

separator "BOOT — AT+CVERSION;+CGMM;+CGSN;+CIMI;+QCCID;+CNUM;+QGETCAPABILITY"
qcmd 'AT+CVERSION;+CGMM;+CGSN;+CIMI;+QCCID;+CNUM;+QGETCAPABILITY' 2>/dev/null

separator "BOOT — AT+QNWPREFCFG=\"policy_band\" (locked bands)"
qcmd 'AT+QNWPREFCFG="policy_band"' 2>/dev/null

separator "BOOT — AT+CFUN? (radio function mode)"
qcmd 'AT+CFUN?' 2>/dev/null

# --- Current poller cache for comparison ---

separator "POLLER CACHE — /tmp/qmanager_status.json (current cached state)"
if [ -f /tmp/qmanager_status.json ]; then
    cat /tmp/qmanager_status.json
else
    echo "(file not found)"
fi

separator "DONE"
printf 'Debug dump complete: %s\n' "$(date)"
printf 'Network mode (from cache): '
jq -r '.network.network_type // "unknown"' /tmp/qmanager_status.json 2>/dev/null || echo "unknown"
