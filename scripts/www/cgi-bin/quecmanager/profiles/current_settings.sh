#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
. /usr/lib/qmanager/sim_db.sh
# =============================================================================
# current_settings.sh — CGI Endpoint: Current Modem Settings
# =============================================================================
# Queries the modem for current APN, IMEI, and ICCID.
# Used to pre-fill the profile creation form with live modem values.
#
# Uses compound AT syntax (semicolon-separated) to fetch all data in
# a single modem round-trip for fast page load.
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
cgi_handle_options

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2   # Gap between AT commands (seconds) — kept for POST if needed

qlog_info "Querying current modem settings for profile form"

# --- Compound AT: fetch all settings in one call ---
raw=$(qcmd 'AT+CGDCONT?;+CGSN;+QCCID;+CGPADDR;+QMAP="WWAN"' 2>/dev/null)

# --- 1. APN profiles from +CGDCONT: lines ---
cgdcont_lines=$(printf '%s\n' "$raw" | grep '+CGDCONT:')
apn_array=$(parse_cgdcont "$cgdcont_lines")

# --- 2. Current IMEI — bare 15-digit line from AT+CGSN ---
current_imei=$(printf '%s\n' "$raw" | tr -d '\r' | grep -x '[0-9]\{15\}' | head -1)

# --- 3. Current ICCID from +QCCID: line ---
# Use the canonical apply-time pipeline (keep the raw string) then strip only
# the trailing BCD pad F via iccid_canonicalize, so a profile saved from this
# form stores the same value apply-time compares against. The old digits-only
# extractor silently dropped the pad, diverging from every apply-time reader.
current_iccid=$(iccid_canonicalize "$(printf '%s\n' "$raw" | grep '+QCCID:' | head -1 | sed 's/+QCCID: //g')")

# --- 4. Active CID (cross-reference +CGPADDR + +QMAP lines from blob) ---
active_cid=""

# CGPADDR: collect CIDs with valid IPv4
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

# QMAP: authoritative WAN CID
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
