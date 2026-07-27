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
raw=$(qcmd 'AT+CGDCONT?;+CGSN;+QCCID;+CGPADDR;+QMAP="WWAN";+QSPN' 2>/dev/null)

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

# --- 4. Carrier identity from +QSPN: line ---
# +QSPN: "<FNN>","<SNN>","<SPN>",<disp_cond>,"<RPLMN>"
#         ^1st    ^2nd    ^3rd              ^last
# Confirmed on a live RM520N-GL:
#   +QSPN: "GLOBE","GLOBE","GLOBE",0,"51502"
#
# The three name fields answer DIFFERENT questions, and the distinction is the
# whole reason this block exists:
#
#   FNN (Full Network Name)     — read from the SIM's EF_PNN. Describes the
#                                 NETWORK. An MVNO reselling a host network
#                                 usually inherits the host's name here.
#   SPN (Service Provider Name) — read from the SIM's EF_SPN. Describes the
#                                 SERVICE PROVIDER, i.e. who sold the SIM. This
#                                 is the field an MVNO brands: a Mint SIM on
#                                 T-Mobile's network reads FNN="T-Mobile",
#                                 SPN="Mint".
#
# Both are emitted because EF_SPN is OPTIONAL — plenty of SIMs leave it blank
# or copy the network name into it. The client's MVNO filter matches either,
# so a reseller that brands via EF_PNN is caught too.
#
# The last quoted field is the concatenated numeric PLMN (MCC + MNC), e.g.
# "51502" -> mcc=515, mnc=02. MNC length is NOT fixed (2 or 3 digits), so
# split as first-3 / rest rather than assuming a fixed width. Fail soft to
# empty strings on any absent/malformed +QSPN — this endpoint must always
# return 200, even on a SIM-less modem.
qspn_line=$(printf '%s\n' "$raw" | tr -d '\r' | grep '+QSPN:' | head -1)
current_network_name=""
current_spn=""
current_plmn=""
if [ -n "$qspn_line" ]; then
    # awk -F'"' splits on the quote character, so the Nth quoted value lands in
    # field 2N: FNN=$2, SNN=$4, SPN=$6. NF-1 is the trailing PLMN regardless of
    # how many name fields the firmware actually emits.
    current_network_name=$(printf '%s\n' "$qspn_line" | awk -F'"' '{print $2}')
    current_spn=$(printf '%s\n' "$qspn_line" | awk -F'"' '{print $6}')
    current_plmn=$(printf '%s\n' "$qspn_line" | awk -F'"' '{print $(NF-1)}')
fi
# Guard: the PLMN field must be all-digits with at least 4 chars (min a
# 3-digit MCC + 1-digit MNC) or we treat it as malformed/absent. The empty /
# any-non-digit case is rejected FIRST — a bare [0-9][0-9][0-9][0-9]* glob
# would only constrain the leading four characters and let a corrupt tail
# (e.g. "5150A") through into the MNC.
#
# Only the NUMERIC fields are cleared here. The name fields are parsed from
# independent positions and stay valid on their own; blanking them as
# collateral for a malformed PLMN would throw away the one identity an MVNO
# actually controls.
case "$current_plmn" in
    ''|*[!0-9]*)
        current_mcc=""
        current_mnc=""
        ;;
    [0-9][0-9][0-9][0-9]*)
        current_mcc=$(printf '%s' "$current_plmn" | cut -c1-3)
        current_mnc=$(printf '%s' "$current_plmn" | cut -c4-)
        ;;
    *)
        current_mcc=""
        current_mnc=""
        ;;
esac

# --- 5. Active CID (cross-reference +CGPADDR + +QMAP lines from blob) ---
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
    --arg spn "$current_spn" \
    --arg network_name "$current_network_name" \
    --arg mcc "$current_mcc" \
    --arg mnc "$current_mnc" \
    '{
        "apn_profiles": $apns,
        "imei": $imei,
        "iccid": $iccid,
        "active_cid": ($active_cid | tonumber),
        "spn": $spn,
        "network_name": $network_name,
        "mcc": $mcc,
        "mnc": $mnc
    }'

qlog_info "Current settings query complete (active_cid=$active_cid)"
