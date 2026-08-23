#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
# =============================================================================
# network_priority.sh — CGI Endpoint: RAT Acquisition Order (GET + POST)
# =============================================================================
# GET:  Reads current RAT acquisition order via AT+QNWPREFCFG="rat_acq_order"
# POST: Sets new RAT acquisition order
#
# AT commands:
#   AT+QNWPREFCFG="rat_acq_order"              -> Current order (e.g. NR5G:LTE)
#   AT+QNWPREFCFG="rat_acq_order",<order>      -> Set order (e.g. LTE:NR5G)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/network_priority.sh
# Install location: /www/cgi-bin/quecmanager/cellular/network_priority.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_net_prio"
cgi_headers
cgi_handle_options

# =============================================================================
# GET — Fetch current RAT acquisition order
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching RAT acquisition order"

    resp=$(run_at 'AT+QNWPREFCFG="rat_acq_order"')

    if [ -z "$resp" ]; then
        cgi_error "at_failed" "Failed to query rat_acq_order"
        exit 0
    fi

    # +QNWPREFCFG: "rat_acq_order",NR5G:LTE:WCDMA   (x5x firmware)
    # +QNWPREFCFG: "rat_order_pref",NR5G:LTE:WCDMA  (x6x firmware, e.g. RM521F-GL)
    order=$(printf '%s' "$resp" | awk -F',' '
        /\+QNWPREFCFG:.*"(rat_acq_order|rat_order_pref)"/ {
            val = $2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
            if (val != "") { print val; exit }
        }
    ')

    if [ -z "$order" ]; then
        cgi_error "parse_failed" "Could not parse rat_acq_order response"
        exit 0
    fi

    qlog_info "RAT acquisition order: $order"

    jq -n --arg order "$order" '{success: true, order: $order}'
    exit 0
fi

# =============================================================================
# POST — Set RAT acquisition order
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ORDER=$(printf '%s' "$POST_DATA" | jq -r '.order // empty')

    if [ -z "$ORDER" ]; then
        cgi_error "missing_order" "order field is required"
        exit 0
    fi

    # Validate: only allow known RAT names separated by colons
    case "$ORDER" in
        *[!A-Z0-9:]*)
            cgi_error "invalid_order" "order must contain only RAT names separated by colons"
            exit 0
            ;;
    esac

    qlog_info "Setting RAT acquisition order: $ORDER"

    # qcmd never writes the literal string "ERROR" to stdout — a failure is
    # signaled by exit status + stderr, with stdout left empty — so matching
    # stdout for "*ERROR*" here could never fire and a rejected write always
    # fell through to "success". rc is captured on the very next statement,
    # before anything else touches $?. A write additionally needs to see the
    # modem's own "OK": qcmd's third exit arm can return 0 with unconfirmed
    # pass-through data for a response that contains neither OK nor ERROR.
    # The assertion must match a LINE that IS "OK", not a substring —
    # $result is the command echoed back plus its response, and $ORDER (only
    # validated as uppercase/digits/colons) can legitimately contain the two
    # characters "OK" itself, which would false-positive a `*OK*` glob. Same
    # convention as strip_at_response's `/^OK$/d`.
    result=$(qcmd "AT+QNWPREFCFG=\"rat_acq_order\",$ORDER" 2>/dev/null)
    rc=$?
    order_ok="false"
    if [ $rc -eq 0 ] && printf '%s' "$result" | tr -d '\r' | grep -qx 'OK'; then
        order_ok="true"
    fi
    if [ "$order_ok" != "true" ]; then
        qlog_error "Failed to set rat_acq_order (rc=$rc): $result"
        cgi_error "at_failed" "Modem rejected the RAT acquisition order"
        exit 0
    fi

    qlog_info "RAT acquisition order set to: $ORDER"
    cgi_success
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
