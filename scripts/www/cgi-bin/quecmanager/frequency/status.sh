#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# status.sh — CGI Endpoint: Get Frequency Lock Status
# =============================================================================
# Returns current frequency lock state from the modem (AT+QNWCFG queries)
# and tower lock state (AT+QNWLOCK queries) for mutual exclusion gating.
#
# Queries 4 AT commands (with sleep between each):
#   1. AT+QNWCFG="lte_earfcn_lock"   — LTE frequency lock state
#   2. AT+QNWCFG="nr5g_earfcn_lock"  — NR5G frequency lock state
#   3. AT+QNWLOCK="common/4g"         — LTE tower lock (for mutual exclusion)
#   4. AT+QNWLOCK="common/5g"         — NR tower lock (for mutual exclusion)
#
# Endpoint: GET /cgi-bin/quecmanager/frequency/status.sh
# Install location: /www/cgi-bin/quecmanager/frequency/status.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_freq_status"
cgi_headers
cgi_handle_options

# --- Load tower lock library (for tower_read_lte_lock / tower_read_nr_lock) --
. /usr/lib/qmanager/tower_lock_mgr.sh 2>/dev/null

# =============================================================================
# Compound AT: fetch both frequency lock states in one call
# =============================================================================
qlog_debug "Querying frequency lock states"
# qcmd signals failure via exit status + stderr, never via stdout — this
# call never even captured rc, so a failed read silently fell through with
# raw="" and every parse below produced lte_locked:false / nr_locked:false.
# That is not "no lock" — it's "we don't know" — and this endpoint's read
# feeds frequency/lock.sh's own tower-lock mutual-exclusion gate (stacking a
# frequency lock on an active tower lock can crash-dump the modem per that
# file's header), so a failed read must report failure, not "unlocked".
raw=$(qcmd 'AT+QNWCFG="lte_earfcn_lock";+QNWCFG="nr5g_earfcn_lock"' 2>/dev/null)
rc=$?
if [ $rc -ne 0 ] || [ -z "$raw" ]; then
    qlog_error "Frequency lock compound query failed (rc=$rc); refusing to fabricate lock state"
    cgi_error "read_failed" "Unable to read frequency lock state from modem"
    exit 0
fi

# --- LTE frequency lock ---
lte_freq_locked="false"
lte_freq_entries_json="[]"

line=$(printf '%s\n' "$raw" | grep '+QNWCFG:.*"lte_earfcn_lock"' | head -1 | tr -d '\r')
if [ -n "$line" ]; then
    params=$(printf '%s' "$line" | sed 's/.*"lte_earfcn_lock",//' | tr -d ' ')
    count=$(printf '%s' "$params" | cut -d',' -f1)

    if [ "$count" -gt 0 ] 2>/dev/null; then
        lte_freq_locked="true"
        earfcn_str=$(printf '%s' "$params" | cut -d',' -f2)
        # Split colon-separated EARFCNs into JSON array
        lte_freq_entries_json="["
        first="true"
        OLD_IFS="$IFS"
        IFS=":"
        for earfcn in $earfcn_str; do
            [ -z "$earfcn" ] && continue
            if [ "$first" = "true" ]; then
                first="false"
            else
                lte_freq_entries_json="${lte_freq_entries_json},"
            fi
            lte_freq_entries_json="${lte_freq_entries_json}{\"earfcn\":$earfcn}"
        done
        IFS="$OLD_IFS"
        lte_freq_entries_json="${lte_freq_entries_json}]"
    fi
fi

# --- NR5G frequency lock ---
nr_freq_locked="false"
nr_freq_entries_json="[]"

line=$(printf '%s\n' "$raw" | grep '+QNWCFG:.*"nr5g_earfcn_lock"' | head -1 | tr -d '\r')
if [ -n "$line" ]; then
    params=$(printf '%s' "$line" | sed 's/.*"nr5g_earfcn_lock",//' | tr -d ' ')
    count=$(printf '%s' "$params" | cut -d',' -f1)

    if [ "$count" -gt 0 ] 2>/dev/null; then
        nr_freq_locked="true"
        arfcn_str=$(printf '%s' "$params" | cut -d',' -f2)
        # Parse alternating EARFCN:SCS pairs
        nr_freq_entries_json="["
        first="true"
        set -- $(printf '%s' "$arfcn_str" | tr ':' ' ')
        while [ $# -ge 2 ]; do
            if [ "$first" = "true" ]; then
                first="false"
            else
                nr_freq_entries_json="${nr_freq_entries_json},"
            fi
            nr_freq_entries_json="${nr_freq_entries_json}{\"arfcn\":$1,\"scs\":$2}"
            shift 2
        done
        nr_freq_entries_json="${nr_freq_entries_json}]"
    fi
fi

# =============================================================================
# Query tower lock state (for mutual exclusion gating)
# =============================================================================
qlog_debug "Checking tower lock state for gating"
# tower_lock_lte / tower_lock_nr are tri-state on the wire: true, false, or
# the JSON literal null when the tower state could not be read at all. A
# failed read must never be reported as "false" (no lock) — this feeds
# frequency/lock.sh's own mutual-exclusion gate, and "unlocked" is a
# fabricated fact that can walk a user straight into the stacked-lock
# crash-dump path that file's header warns about. The frontend treats null
# as blocking (fail-safe) with its own distinct copy.
lte_tower_state=$(tower_read_lte_lock 2>/dev/null)
lte_tower_rc=$?
if [ $lte_tower_rc -ne 0 ] || [ -z "$lte_tower_state" ] || [ "$lte_tower_state" = "error" ]; then
    tower_lock_lte="null"
else
    tower_lock_lte="false"
    case "$lte_tower_state" in
        locked*) tower_lock_lte="true" ;;
    esac
fi

sleep 0.1

nr_tower_state=$(tower_read_nr_lock 2>/dev/null)
nr_tower_rc=$?
if [ $nr_tower_rc -ne 0 ] || [ -z "$nr_tower_state" ] || [ "$nr_tower_state" = "error" ]; then
    tower_lock_nr="null"
else
    tower_lock_nr="false"
    case "$nr_tower_state" in
        locked*) tower_lock_nr="true" ;;
    esac
fi

# =============================================================================
# Build response JSON
# =============================================================================
response_json=$(jq -n \
    --argjson lte_locked "$lte_freq_locked" \
    --argjson lte_entries "$lte_freq_entries_json" \
    --argjson nr_locked "$nr_freq_locked" \
    --argjson nr_entries "$nr_freq_entries_json" \
    --argjson tower_lte "$tower_lock_lte" \
    --argjson tower_nr "$tower_lock_nr" \
    '{
        success: true,
        modem_state: {
            lte_locked: $lte_locked,
            lte_entries: $lte_entries,
            nr_locked: $nr_locked,
            nr_entries: $nr_entries,
            tower_lock_lte_active: $tower_lte,
            tower_lock_nr_active: $tower_nr
        }
    }' 2>/dev/null)

if [ -n "$response_json" ]; then
    printf '%s\n' "$response_json"
else
    qlog_error "Failed to build status JSON with jq, sending fallback"
    printf '{"success":true,"modem_state":{"lte_locked":false,"lte_entries":[],"nr_locked":false,"nr_entries":[],"tower_lock_lte_active":null,"tower_lock_nr_active":null}}\n'
fi
