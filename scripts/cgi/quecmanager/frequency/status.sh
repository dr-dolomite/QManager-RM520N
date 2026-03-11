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

# --- Load tower lock library (for tower_read_lte_lock / tower_read_nr_lock) --
. /usr/lib/qmanager/tower_lock_mgr.sh 2>/dev/null

# =============================================================================
# Query LTE frequency lock state
# =============================================================================
qlog_debug "Querying LTE frequency lock state"
lte_result=$(qcmd 'AT+QNWCFG="lte_earfcn_lock"' 2>/dev/null)
lte_rc=$?

lte_freq_locked="false"
lte_freq_entries_json="[]"

if [ $lte_rc -eq 0 ] && [ -n "$lte_result" ]; then
    line=$(printf '%s' "$lte_result" | grep '+QNWCFG:' | head -1 | tr -d '\r')
    if [ -n "$line" ]; then
        # Extract everything after "lte_earfcn_lock",
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
else
    qlog_warn "Failed to query LTE frequency lock (rc=$lte_rc)"
fi

sleep 0.1

# =============================================================================
# Query NR5G frequency lock state
# =============================================================================
qlog_debug "Querying NR5G frequency lock state"
nr_result=$(qcmd 'AT+QNWCFG="nr5g_earfcn_lock"' 2>/dev/null)
nr_rc=$?

nr_freq_locked="false"
nr_freq_entries_json="[]"

if [ $nr_rc -eq 0 ] && [ -n "$nr_result" ]; then
    line=$(printf '%s' "$nr_result" | grep '+QNWCFG:' | head -1 | tr -d '\r')
    if [ -n "$line" ]; then
        # Extract everything after "nr5g_earfcn_lock",
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
else
    qlog_warn "Failed to query NR5G frequency lock (rc=$nr_rc)"
fi

sleep 0.1

# =============================================================================
# Query tower lock state (for mutual exclusion gating)
# =============================================================================
qlog_debug "Checking tower lock state for gating"
tower_lock_lte="false"
lte_tower_state=$(tower_read_lte_lock 2>/dev/null)
case "$lte_tower_state" in
    locked*) tower_lock_lte="true" ;;
esac

sleep 0.1

tower_lock_nr="false"
nr_tower_state=$(tower_read_nr_lock 2>/dev/null)
case "$nr_tower_state" in
    locked*) tower_lock_nr="true" ;;
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
    printf '{"success":true,"modem_state":{"lte_locked":false,"lte_entries":[],"nr_locked":false,"nr_entries":[],"tower_lock_lte_active":false,"tower_lock_nr_active":false}}\n'
fi
