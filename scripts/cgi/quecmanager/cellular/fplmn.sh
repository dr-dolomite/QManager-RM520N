#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# fplmn.sh — CGI Endpoint: FPLMN Status & Clear (GET + POST)
# =============================================================================
# GET:  Reads the FPLMN list from the SIM via AT+CRSM.
# POST: Clears the FPLMN list by writing all-FFs back to the SIM.
#
# AT commands used:
#   AT+CRSM=176,28539,0,0,12   -> Read FPLMN data (EF_FPLMN)
#   AT+CRSM=214,28539,0,0,12,"FFFFFFFFFFFFFFFFFFFFFFFF"  -> Clear FPLMN
#
# The FPLMN data is 12 bytes (24 hex chars). All-FFs means the list is empty.
# Any other content means forbidden PLMNs are present.
#
# No reboot required for clearing.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/fplmn.sh
# Install location: /www/cgi-bin/quecmanager/cellular/fplmn.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_fplmn"
cgi_headers
cgi_handle_options

# =============================================================================
# GET — Read FPLMN status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading FPLMN list"

    resp=$(qcmd 'AT+CRSM=176,28539,0,0,12' 2>/dev/null)
    if [ -z "$resp" ]; then
        qlog_error "AT+CRSM read returned empty"
        cgi_error "crsm_failed" "Failed to read FPLMN data from SIM"
        exit 0
    fi

    case "$resp" in
        *ERROR*)
            qlog_error "AT+CRSM read failed: $resp"
            cgi_error "crsm_failed" "Failed to read FPLMN data from SIM"
            exit 0
            ;;
    esac

    # Extract the hex data from +CRSM: <sw1>,<sw2>,"<data>"
    fplmn_data=$(printf '%s' "$resp" | grep '+CRSM:' | head -1 | sed 's/.*"\(.*\)".*/\1/' | tr -d ' \r')

    if [ -z "$fplmn_data" ]; then
        qlog_warn "Could not parse FPLMN data from response"
        cgi_error "parse_failed" "Could not parse FPLMN response"
        exit 0
    fi

    # All-FFs means the list is clean (no forbidden PLMNs)
    has_entries="true"
    case "$fplmn_data" in
        FFFFFFFFFFFFFFFFFFFFFFFF|ffffffffffffffffffffffff)
            has_entries="false"
            ;;
    esac

    qlog_info "FPLMN data=$fplmn_data has_entries=$has_entries"

    jq -n \
        --argjson has_entries "$has_entries" \
        --arg raw_data "$fplmn_data" \
        '{
            success: true,
            has_entries: $has_entries,
            raw_data: $raw_data
        }'
    exit 0
fi

# =============================================================================
# POST — Clear FPLMN list
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    qlog_info "Clearing FPLMN list"

    resp=$(qcmd 'AT+CRSM=214,28539,0,0,12,"FFFFFFFFFFFFFFFFFFFFFFFF"' 2>/dev/null)
    if [ -z "$resp" ]; then
        qlog_error "AT+CRSM write returned empty"
        cgi_error "crsm_failed" "Failed to clear FPLMN data"
        exit 0
    fi

    case "$resp" in
        *ERROR*)
            qlog_error "AT+CRSM write failed: $resp"
            cgi_error "crsm_failed" "Failed to clear FPLMN data"
            exit 0
            ;;
    esac

    qlog_info "FPLMN list cleared"
    cgi_success
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
