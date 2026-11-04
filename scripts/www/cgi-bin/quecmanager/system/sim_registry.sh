#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/sim_db.sh
. /usr/lib/qmanager/sim_registry.sh
# =============================================================================
# sim_registry.sh — CGI Endpoint: Persistent SIM Registry (GET + POST)
# =============================================================================
# The SIM registry (/etc/qmanager/sim_registry.json, root:root 0644) tracks
# per-ICCID carrier/phone_number/first_seen/dismissed, replacing the old
# root-owned /tmp/qmanager_sim_swap_detected flag as the source of truth for
# "New SIM detected" banner dismissal — www-data could never write that /tmp
# file (root-owned), so dismissal previously lived only in browser
# localStorage and never survived a reboot. This registry does.
#
# root is the SOLE direct writer (see sim_registry.sh). This CGI's `list`
# action is a plain read of the world-readable file — no sudo. `dismiss` and
# `undismiss` shell out to the qmanager_sim_registry_apply root helper via
# sudo, which owns ALL validation (ICCID charset/length, action enum) and the
# atomic scoped-field write.
#
# GET (or POST {"action":"list"}):
#   {"success":true,"sims":[{"iccid":"...","carrier":"...",
#     "phone_number":"...","first_seen":"..."|null,"dismissed":false,
#     "active":true}]}
#   "active" is true for the ICCID currently in the modem, read from the
#   live /tmp/qmanager_status.json (.device.iccid) — no fresh AT command is
#   issued. Sorted active-first, then by first_seen descending (nulls last).
#
# POST {"action":"dismiss","iccid":"<iccid>"}:
#   {"success":true,"dismissed":true}
# POST {"action":"undismiss","iccid":"<iccid>"}:
#   {"success":true,"dismissed":false}
#
# Errors: {"success":false,"error":"<machine_code>","detail":"<human text>"}
#   with a Status: header set before cgi_headers (matching auth/login.sh's
#   deferred-header pattern) — 400 for bad input, 404 for an unknown ICCID,
#   405 for a bad method, 503 for a lock timeout, 500 otherwise. An unknown
#   ICCID is always an error; it is NEVER auto-created by dismiss/undismiss.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/sim_registry.sh
# Install location: /www/cgi-bin/quecmanager/system/sim_registry.sh
# =============================================================================

qlog_init "cgi_sim_registry"

STATUS_FILE="/tmp/qmanager_status.json"

# CORS preflight — headers are deferred elsewhere (to allow a non-200 Status:
# line ahead of them, mirroring auth/login.sh), so OPTIONS is handled first
# and explicitly rather than via cgi_handle_options.
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    cgi_headers
    exit 0
fi

# --- list_sims — shared by GET and POST {"action":"list"} -------------------
list_sims() {
    active_iccid=""
    if [ -f "$STATUS_FILE" ]; then
        active_iccid=$(jq -r '(.device.iccid // "")' "$STATUS_FILE" 2>/dev/null)
        active_iccid=$(sim_db_normalize "$active_iccid")
    fi

    reg_json='{}'
    if [ -f "$SIM_REGISTRY_FILE" ]; then
        reg_json=$(cat "$SIM_REGISTRY_FILE" 2>/dev/null)
        [ -z "$reg_json" ] && reg_json='{}'
    fi
    # Defend against a corrupted registry file — degrade to empty rather than
    # letting --argjson below hard-fail the whole response.
    if ! printf '%s' "$reg_json" | jq empty >/dev/null 2>&1; then
        qlog_warn "sim_registry.json failed to parse — serving empty list"
        reg_json='{}'
    fi

    jq -n --arg active "$active_iccid" --argjson reg "$reg_json" '
        ($reg | to_entries | map({
            iccid: .key,
            carrier: (.value.carrier // ""),
            phone_number: (.value.phone_number // ""),
            first_seen: (.value.first_seen // null),
            dismissed: (.value.dismissed // false),
            active: (.key == $active)
        })) as $all
        | ($all | map(select(.active))) as $act
        | ($all
            | map(select(.active | not))
            | sort_by(if .first_seen == null then "" else .first_seen end)
            | reverse
          ) as $rest
        | {success: true, sims: ($act + $rest)}
    '
}

# =============================================================================
# GET — List the SIM registry
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    cgi_headers
    list_sims
    exit 0
fi

# =============================================================================
# POST — Actions (list, dismiss, undismiss)
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    # Read the POST body inline (not via cgi_read_post) so headers stay
    # deferred — cgi_read_post's own error path calls cgi_error before any
    # Content-Type header would have been emitted.
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    else
        echo "Status: 400 Bad Request"
        cgi_headers
        cgi_error "no_body" "POST body is empty"
        exit 0
    fi

    action=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end' 2>/dev/null)
    post_iccid=$(printf '%s' "$POST_DATA" | jq -r 'if .iccid == null then empty else .iccid end' 2>/dev/null)

    case "$action" in
        list|"")
            cgi_headers
            list_sims
            exit 0
            ;;
        dismiss|undismiss)
            if [ -z "$post_iccid" ]; then
                echo "Status: 400 Bad Request"
                cgi_headers
                cgi_error "missing_iccid" "iccid is required"
                exit 0
            fi

            qlog_info "SIM registry: $action iccid=...$(printf '%s' "$post_iccid" | tail -c 4)"

            helper_out=$(sudo -n /usr/bin/qmanager_sim_registry_apply "$post_iccid" "$action" 2>&1)
            helper_rc=$?

            case "$helper_rc" in
                0)
                    cgi_headers
                    printf '%s\n' "$helper_out"
                    exit 0
                    ;;
                3)
                    qlog_warn "qmanager_sim_registry_apply: unknown ICCID"
                    echo "Status: 404 Not Found"
                    cgi_headers
                    printf '%s\n' "$helper_out"
                    exit 0
                    ;;
                2)
                    qlog_error "qmanager_sim_registry_apply: lock timeout"
                    echo "Status: 503 Service Unavailable"
                    cgi_headers
                    printf '%s\n' "$helper_out"
                    exit 0
                    ;;
                *)
                    qlog_error "qmanager_sim_registry_apply failed rc=$helper_rc: $helper_out"
                    echo "Status: 500 Internal Server Error"
                    cgi_headers
                    cgi_error "apply_failed" "Failed to update the SIM registry"
                    exit 0
                    ;;
            esac
            ;;
        *)
            echo "Status: 400 Bad Request"
            cgi_headers
            cgi_error "invalid_action" "Action must be: list, dismiss, or undismiss"
            exit 0
            ;;
    esac
fi

# --- Method not allowed -------------------------------------------------------
echo "Status: 405 Method Not Allowed"
cgi_headers
cgi_method_not_allowed
