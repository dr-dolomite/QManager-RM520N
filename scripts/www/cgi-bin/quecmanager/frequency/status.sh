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
raw=$(qcmd 'AT+QNWCFG="lte_earfcn_lock";+QNWCFG="nr5g_earfcn_lock"' 2>/dev/null)
[ -z "$raw" ] && qlog_warn "Frequency lock compound query returned empty response"

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
# tower_lock_*_active only ever reflected `locked*)` — both "unlocked" and a
# failed/ambiguous "error" read landed in the same non-match and reported a
# confident false, which is what let frequency/lock.sh's mirror of this same
# gate fail OPEN on a failed read (see lock.sh's own error) branches). This
# script cannot refuse anything itself (it is read-only), but it must not
# keep telling the frontend "definitely not locked" when the read failed —
# so tower_lock_*_active keeps its existing meaning and gains a sibling
# *_read_ok, same convention as tower/status.sh. A field ABSENT entirely
# (an un-upgraded CGI) must be treated by the frontend as true (trusted) —
# only an explicit false means "do not trust tower_lock_*_active".
qlog_debug "Checking tower lock state for gating"
tower_lock_lte="false"
tower_lock_lte_read_ok="true"
lte_tower_state=$(tower_read_lte_lock 2>/dev/null)
case "$lte_tower_state" in
    locked*) tower_lock_lte="true" ;;
    error) tower_lock_lte_read_ok="false" ;;
esac

sleep 0.1

tower_lock_nr="false"
tower_lock_nr_read_ok="true"
nr_tower_state=$(tower_read_nr_lock 2>/dev/null)
case "$nr_tower_state" in
    locked*) tower_lock_nr="true" ;;
    error) tower_lock_nr_read_ok="false" ;;
esac

# =============================================================================
# Build response JSON
# =============================================================================
response_json=$(jq -n \
    --argjson lte_locked "$lte_freq_locked" \
    --argjson lte_entries "$lte_freq_entries_json" \
    --argjson nr_locked "$nr_freq_locked" \
    --argjson nr_entries "$nr_freq_entries_json" \
    --argjson tower_lte "$tower_lock_lte" \
    --argjson tower_lte_ok "$tower_lock_lte_read_ok" \
    --argjson tower_nr "$tower_lock_nr" \
    --argjson tower_nr_ok "$tower_lock_nr_read_ok" \
    '{
        success: true,
        modem_state: {
            lte_locked: $lte_locked,
            lte_entries: $lte_entries,
            nr_locked: $nr_locked,
            nr_entries: $nr_entries,
            tower_lock_lte_active: $tower_lte,
            tower_lock_lte_read_ok: $tower_lte_ok,
            tower_lock_nr_active: $tower_nr,
            tower_lock_nr_read_ok: $tower_nr_ok
        }
    }' 2>/dev/null)

if [ -n "$response_json" ]; then
    printf '%s\n' "$response_json"
else
    # jq itself failed here — unlike an absent field on an un-upgraded CGI,
    # this script DID run and DID fail, so read_ok is honestly false rather
    # than omitted.
    qlog_error "Failed to build status JSON with jq, sending fallback"
    printf '{"success":true,"modem_state":{"lte_locked":false,"lte_entries":[],"nr_locked":false,"nr_entries":[],"tower_lock_lte_active":false,"tower_lock_lte_read_ok":false,"tower_lock_nr_active":false,"tower_lock_nr_read_ok":false}}\n'
fi
