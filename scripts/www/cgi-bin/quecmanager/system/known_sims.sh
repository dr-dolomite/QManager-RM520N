#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/sim_db.sh
# =============================================================================
# known_sims.sh — CGI Endpoint: Known-SIMs Database (GET + POST)
# =============================================================================
# The known-SIMs database is a persistent set of ICCIDs the device has already
# "seen". qmanager_poller fires the "New SIM detected" banner exactly when the
# inserted SIM's ICCID is NOT in this set (see sim_db.sh).
#
# GET (or POST {"action":"list"}):
#   Returns {"success":true,"count":<N>} where N = number of known ICCIDs.
#
# POST {"action":"clear"}:
#   Resets the set to contain ONLY the currently-inserted SIM (read live via
#   AT+QCCID). The inserted SIM stays known so clearing does not immediately
#   re-fire the banner. If no SIM is present, the set is emptied. Also drops
#   any stale /tmp/qmanager_sim_swap_detected banner flag.
#
#   Clearing spans BOTH SIM stores. The set above answers "is this SIM new";
#   the sim_registry.json sidecar answers "what do we know about it" and backs
#   the Tracked SIMs card. Clearing only the set leaves the card listing SIMs
#   the count says are forgotten, so the sidecar is reduced to the same single
#   record via the qmanager_sim_registry_apply root helper (clear_keep). The
#   kept record is preserved verbatim, so an already-dismissed banner for the
#   inserted SIM does not come back.
#
#   Returns {"success":true,"count":<N>,"registry_cleared":true|false}.
#   registry_cleared is false when the sidecar write failed — the set was
#   still cleared, but the Tracked SIMs list may be stale.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/known_sims.sh
# Install location: /www/cgi-bin/quecmanager/system/known_sims.sh
# =============================================================================

qlog_init "cgi_known_sims"
cgi_headers
cgi_handle_options

SIM_SWAP_FLAG="/tmp/qmanager_sim_swap_detected"

# =============================================================================
# GET — Report the known-SIMs count
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    count=$(sim_db_count)
    jq -n --argjson count "$count" '{success: true, count: $count}'
    exit 0
fi

# =============================================================================
# POST — Actions (list, clear)
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    action=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    case "$action" in
        list)
            count=$(sim_db_count)
            jq -n --argjson count "$count" '{success: true, count: $count}'
            ;;
        clear)
            qlog_info "Clearing known-SIMs set + registry (keeping currently-inserted SIM)"
            # Canonical QCCID pipeline — byte-identical to all other read sites.
            cur=$(qcmd 'AT+QCCID' 2>/dev/null | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
            sim_db_clear_keep "$cur"

            # The Tracked SIMs list is a SEPARATE store (sim_registry.json,
            # root-owned). Clearing only the set above left the card listing
            # SIMs the count already reported as forgotten. www-data cannot
            # write the sidecar, so this goes through the same root helper the
            # dismiss path uses. Reported back rather than swallowed: if the
            # sidecar write fails, the UI must not claim a clean sweep.
            registry_cleared=false
            if sudo -n /usr/bin/qmanager_sim_registry_apply "$cur" clear_keep >/dev/null 2>&1; then
                registry_cleared=true
            else
                qlog_warn "sim_registry clear_keep failed; Tracked SIMs may still list forgotten SIMs"
            fi

            rm -f "$SIM_SWAP_FLAG"
            count=$(sim_db_count)
            qlog_info "Known-SIMs set cleared; count now $count (registry_cleared=$registry_cleared)"
            jq -n \
                --argjson count "$count" \
                --argjson registry_cleared "$registry_cleared" \
                '{success: true, count: $count, registry_cleared: $registry_cleared}'
            ;;
        *)
            cgi_error "invalid_action" "Action must be: list or clear"
            ;;
    esac
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
