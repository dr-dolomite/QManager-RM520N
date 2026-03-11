#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
# =============================================================================
# current_settings.sh — CGI Endpoint: Current Modem Settings
# =============================================================================
# Queries the modem for current APN, IMEI, and ICCID.
# Used to pre-fill the profile creation form with live modem values.
#
# Sip-don't-gulp: each AT command goes through qcmd individually with
# sleep gaps between, so the poller can slip in.
#
# Called ONCE when the user opens the profile form, not on a timer.
#
# NOTE: Band locking and network mode queries have been removed.
# They will be owned by the Connection Scenarios feature.
#
# Endpoint: GET /cgi-bin/quecmanager/profiles/current_settings.sh
# Response: CurrentModemSettings JSON (see types/sim-profile.ts)
#
# Install location: /www/cgi-bin/quecmanager/profiles/current_settings.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_current_settings"
cgi_headers

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2   # Gap between AT commands (seconds)

qlog_info "Querying current modem settings for profile form"

# --- 1. APN profiles from AT+CGDCONT? ----------------------------------------
cgdcont_resp=$(run_at "AT+CGDCONT?")
sleep "$CMD_GAP"

# Parse: +CGDCONT: <cid>,"<pdp_type>","<apn>",...
apn_array=$(parse_cgdcont "$cgdcont_resp")

# --- 2. Current IMEI from AT+CGSN --------------------------------------------
imei_resp=$(run_at "AT+CGSN")
current_imei=$(printf '%s' "$imei_resp" | grep -o '[0-9]\{15\}' | head -1)
sleep "$CMD_GAP"

# --- 3. Current ICCID from AT+QCCID ------------------------------------------
iccid_resp=$(run_at "AT+QCCID")
current_iccid=$(printf '%s' "$iccid_resp" | grep -o '[0-9]\{19,20\}' | head -1)
sleep "$CMD_GAP"

# --- Determine active CID (cross-reference CGPADDR + QMAP) ---------------
detect_active_cid

# =============================================================================
# Build and output response JSON
# =============================================================================

jq -n --argjson apns "$apn_array" \
    --arg imei "$current_imei" \
    --arg iccid "$current_iccid" \
    --arg active_cid "$active_cid" \
    '{
        "apn_profiles": $apns,
        "imei": $imei,
        "iccid": $iccid,
        "active_cid": ($active_cid | tonumber)
    }'

qlog_info "Current settings query complete (active_cid=$active_cid)"
