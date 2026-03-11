#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
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
#   AT+CGDCONT=<cid>,"<pdp_type>","<apn>"  -> Set APN for a CID
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
TTL_FILE="/etc/firewall.user.ttl"

# =============================================================================
# GET — Fetch carrier profiles and active CID
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching APN settings"

    # --- 1. All carrier profiles from AT+CGDCONT? ---
    cgdcont_resp=$(run_at "AT+CGDCONT?")
    sleep "$CMD_GAP"

    # Parse: +CGDCONT: <cid>,"<pdp_type>","<apn>",...
    profiles_json=$(parse_cgdcont "$cgdcont_resp")

    # --- Determine active CID (cross-reference CGPADDR + QMAP) ---------------
    detect_active_cid

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

    # --- Step 2: Apply TTL/HL if explicitly provided (0 = disable custom values) ---
    if [ "$has_ttl" = "true" ] || [ "$has_hl" = "true" ]; then
        qlog_info "Applying TTL=$TTL, HL=$HL"

        # Read current values from firewall rules file
        current_ttl=0
        current_hl=0
        if [ -s "$TTL_FILE" ]; then
            current_ttl=$(grep 'iptables.*--ttl-set' "$TTL_FILE" 2>/dev/null | awk '{for(i=1;i<=NF;i++){if($i=="--ttl-set"){print $(i+1)}}}' | head -1)
            current_hl=$(grep 'ip6tables.*--hl-set' "$TTL_FILE" 2>/dev/null | awk '{for(i=1;i<=NF;i++){if($i=="--hl-set"){print $(i+1)}}}' | head -1)
        fi
        [ -z "$current_ttl" ] && current_ttl=0
        [ -z "$current_hl" ] && current_hl=0

        # Only apply if values actually changed
        if [ "$current_ttl" != "$TTL" ] || [ "$current_hl" != "$HL" ]; then
            # Clear existing rules
            if [ "$current_ttl" -gt 0 ] 2>/dev/null; then
                iptables -t mangle -D POSTROUTING -o rmnet+ -j TTL --ttl-set "$current_ttl" 2>/dev/null
            fi
            if [ "$current_hl" -gt 0 ] 2>/dev/null; then
                ip6tables -t mangle -D POSTROUTING -o rmnet+ -j HL --hl-set "$current_hl" 2>/dev/null
            fi

            # Write new rules file
            > "$TTL_FILE"
            if [ "$TTL" -gt 0 ] 2>/dev/null; then
                echo "iptables -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set $TTL" >> "$TTL_FILE"
                iptables -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set "$TTL"
            fi
            if [ "$HL" -gt 0 ] 2>/dev/null; then
                echo "ip6tables -t mangle -A POSTROUTING -o rmnet+ -j HL --hl-set $HL" >> "$TTL_FILE"
                ip6tables -t mangle -A POSTROUTING -o rmnet+ -j HL --hl-set "$HL"
            fi

            qlog_info "TTL/HL applied: TTL=$TTL, HL=$HL"
        else
            qlog_info "TTL/HL unchanged (TTL=$TTL, HL=$HL)"
        fi
    fi

    cgi_success
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
