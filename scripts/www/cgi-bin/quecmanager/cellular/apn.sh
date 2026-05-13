#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/ttl_state.sh
# =============================================================================
# apn.sh — CGI Endpoint: APN Management (GET + POST)
# =============================================================================
# GET:  Reads all carrier profiles (AT+CGDCONT?) and determines the active CID
#       (the one with WAN connectivity via AT+CGPADDR / AT+QMAP="WWAN").
# POST: Applies APN change via AT+CGDCONT and optionally sets TTL/HL via
#       iptables (for Auto APN presets).
#
# AT commands used (GET):
#   AT+CGDCONT?        -> All PDP contexts (CID, PDP type, APN)
#   AT+CGPADDR         -> IP addresses per CID (find active WAN CID)
#   AT+QMAP="WWAN"     -> Fallback: confirm WAN-connected CID
#
# AT commands used (POST):
#   AT+CGDCONT=<cid>,"<pdp_type>","<apn>"  -> Set APN for a CID (writes NVM)
#   AT+COPS=2                              -> Deregister from network
#   AT+COPS=0                              -> Auto-select operator (reattach,
#                                             forces new bearer with new APN)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/apn.sh
# Install location: /www/cgi-bin/quecmanager/cellular/apn.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_apn"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2

# =============================================================================
# GET — Fetch carrier profiles and active CID
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching APN settings"

    # --- Compound AT: fetch profiles + active CID in one call ---
    raw=$(qcmd 'AT+CGDCONT?;+CGPADDR;+QMAP="WWAN"' 2>/dev/null)
    [ -z "$raw" ] && qlog_warn "APN compound AT query returned empty response"

    # Parse: +CGDCONT: <cid>,"<pdp_type>","<apn>",...
    cgdcont_lines=$(printf '%s\n' "$raw" | grep '+CGDCONT:')
    profiles_json=$(parse_cgdcont "$cgdcont_lines")

    # --- Determine active CID (cross-reference +CGPADDR + +QMAP from blob) ---
    active_cid=""

    cgpaddr_cids=$(printf '%s\n' "$raw" | awk -F'[,"]' '
        /\+CGPADDR:/ {
            cid = $1; gsub(/[^0-9]/, "", cid)
            ip = $3
            if (ip != "" && ip != "0.0.0.0" && ip !~ /^0+(\.0+)*$/) {
                split(ip, octets, ".")
                if (length(octets) == 4 && octets[1]+0 > 0) {
                    print cid
                }
            }
        }
    ')

    qmap_cid=$(printf '%s\n' "$raw" | awk -F',' '
        /\+QMAP:/ {
            gsub(/"/, "", $5)
            ip = $5
            cid = $3
            gsub(/[^0-9]/, "", cid)
            if (ip != "" && ip != "0.0.0.0" && ip != "0:0:0:0:0:0:0:0") {
                print cid
                exit
            }
        }
    ')

    if [ -n "$qmap_cid" ]; then
        active_cid="$qmap_cid"
    elif [ -n "$cgpaddr_cids" ]; then
        active_cid=$(printf '%s\n' "$cgpaddr_cids" | head -1)
    fi
    [ -z "$active_cid" ] && active_cid="1"

    qlog_info "Profiles: $(printf '%s' "$profiles_json" | jq -c length) entries, active_cid=$active_cid"

    jq -n \
        --argjson profiles "$profiles_json" \
        --arg active_cid "$active_cid" \
        '{
            success: true,
            profiles: $profiles,
            active_cid: ($active_cid | tonumber)
        }'
    exit 0
fi

# =============================================================================
# POST — Apply APN change + optional TTL/HL
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    # --- Extract fields ---
    CID=$(printf '%s' "$POST_DATA" | jq -r '.cid // empty | tostring')
    PDP_TYPE=$(printf '%s' "$POST_DATA" | jq -r '.pdp_type // empty')
    APN=$(printf '%s' "$POST_DATA" | jq -r '.apn // empty')
    TTL=$(printf '%s' "$POST_DATA" | jq -r 'if has("ttl") then (.ttl | tostring) else "0" end')
    HL=$(printf '%s' "$POST_DATA" | jq -r 'if has("hl") then (.hl | tostring) else "0" end')
    # Track whether TTL/HL keys were explicitly provided (for 0 = disable)
    has_ttl=$(printf '%s' "$POST_DATA" | jq 'has("ttl")')
    has_hl=$(printf '%s' "$POST_DATA" | jq 'has("hl")')

    qlog_info "Apply APN: cid=$CID pdp=$PDP_TYPE apn=$APN ttl=$TTL hl=$HL"

    # --- Validate ---
    if [ -z "$CID" ] || [ -z "$PDP_TYPE" ] || [ -z "$APN" ]; then
        cgi_error "missing_fields" "cid, pdp_type, and apn are required"
        exit 0
    fi

    # CID must be 1-15
    if [ "$CID" -lt 1 ] 2>/dev/null || [ "$CID" -gt 15 ] 2>/dev/null; then
        cgi_error "invalid_cid" "CID must be 1-15"
        exit 0
    fi
    # Catch non-numeric CID
    case "$CID" in
        *[!0-9]*|"")
            cgi_error "invalid_cid" "CID must be a number 1-15"
            exit 0
            ;;
    esac

    case "$PDP_TYPE" in
        IP|IPV6|IPV4V6) ;;
        *)
            cgi_error "invalid_pdp_type" "PDP type must be IP, IPV6, or IPV4V6"
            exit 0
            ;;
    esac

    # TTL/HL must be 0-255
    case "$TTL" in *[!0-9]*|"") TTL=0 ;; esac
    case "$HL" in *[!0-9]*|"") HL=0 ;; esac
    if [ "$TTL" -gt 255 ] 2>/dev/null; then
        cgi_error "invalid_ttl" "TTL must be 0-255"
        exit 0
    fi
    if [ "$HL" -gt 255 ] 2>/dev/null; then
        cgi_error "invalid_hl" "HL must be 0-255"
        exit 0
    fi

    # --- Step 1: Apply APN via AT+CGDCONT ---
    result=$(qcmd "AT+CGDCONT=$CID,\"$PDP_TYPE\",\"$APN\"" 2>/dev/null)
    case "$result" in
        *ERROR*)
            qlog_error "AT+CGDCONT failed: $result"
            cgi_error "cgdcont_failed" "AT+CGDCONT returned ERROR"
            exit 0
            ;;
        *)
            qlog_info "AT+CGDCONT=$CID,\"$PDP_TYPE\",\"$APN\" OK"
            ;;
    esac

    # --- Step 2: Force bearer refresh so AT+CGDCONT takes effect immediately ---
    # AT+CGDCONT updates the PDP context in NVM, but the live bearer keeps using
    # the old APN until the next attach. COPS=2 (deregister) + COPS=0 (auto-select)
    # forces the modem to re-establish a bearer using the new APN.
    #
    # Both commands are best-effort: COPS=2 returns ERROR if already detached,
    # and a transient COPS=0 ERROR doesn't mean the modem won't reattach. Log
    # and continue; the hook's post-save refetch will surface the real state.
    result=$(qcmd 'AT+COPS=2' 2>/dev/null)
    if [ -z "$result" ]; then
        qlog_warn "AT+COPS=2 returned empty (AT interface unresponsive or locked)"
    else
        case "$result" in
            *ERROR*) qlog_warn "AT+COPS=2 returned ERROR (may already be detached): $result" ;;
            *)       qlog_info "AT+COPS=2 OK (detached)" ;;
        esac
    fi
    sleep 2

    result=$(qcmd 'AT+COPS=0' 2>/dev/null)
    if [ -z "$result" ]; then
        qlog_warn "AT+COPS=0 returned empty (AT interface unresponsive or locked)"
    else
        case "$result" in
            *ERROR*) qlog_warn "AT+COPS=0 returned ERROR (reattach may be delayed): $result" ;;
            *)       qlog_info "AT+COPS=0 OK (reattach requested)" ;;
        esac
    fi
    sleep 2

    # --- Step 3: Re-apply TTL/HL after bearer refresh ---
    # Two scenarios:
    #   (a) Request included ttl/hl: persist + apply those.
    #   (b) Request omitted ttl/hl but persisted state exists: re-apply persisted
    #       values so the new bearer comes up with the user's hotspot-bypass rules
    #       intact. iptables chain rules survive interface flaps, so this is
    #       belt-and-suspenders — but it costs nothing (ttl_state_apply is
    #       idempotent thanks to its drain loop) and matches the documented
    #       intent of "TTL is re-applied after APN change".
    if [ "$has_ttl" = "true" ] || [ "$has_hl" = "true" ]; then
        qlog_info "Applying TTL=$TTL, HL=$HL from request"
        if ttl_state_apply "$TTL" "$HL" && ttl_state_write_persisted "$TTL" "$HL"; then
            qlog_info "TTL/HL applied: TTL=$TTL HL=$HL"
        else
            qlog_warn "TTL/HL apply or persist failed (TTL=$TTL HL=$HL); rules may be partial"
        fi
    else
        read -r persisted_ttl persisted_hl <<EOF
$(ttl_state_read_persisted)
EOF
        persisted_ttl="${persisted_ttl:-0}"
        persisted_hl="${persisted_hl:-0}"
        if [ "$persisted_ttl" -gt 0 ] || [ "$persisted_hl" -gt 0 ]; then
            qlog_info "Re-applying persisted TTL=$persisted_ttl HL=$persisted_hl after APN change"
            if ttl_state_apply "$persisted_ttl" "$persisted_hl"; then
                qlog_info "TTL/HL re-applied from persisted state"
            else
                qlog_warn "TTL/HL re-apply failed; rules may be partial"
            fi
        fi
    fi

    cgi_success
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
