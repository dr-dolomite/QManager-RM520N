#!/bin/sh
# =============================================================================
# current_settings.sh — CGI Endpoint: Current Modem Settings
# =============================================================================
# Queries the modem for current APN, IMEI, network mode, and band settings.
# Used to pre-fill the profile creation form with live modem values.
#
# Sip-don't-gulp: each AT command goes through qcmd individually with
# sleep gaps between, so the poller can slip in.
#
# Called ONCE when the user opens the profile form, not on a timer.
#
# Endpoint: GET /cgi-bin/quecmanager/profiles/current_settings.sh
# Response: CurrentModemSettings JSON (see types/sim-profile.ts)
#
# Install location: /www/cgi-bin/quecmanager/profiles/current_settings.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_debug() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
}
qlog_init "cgi_current_settings"

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2   # Gap between AT commands (seconds)

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: GET, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type"
echo ""

# --- Handle CORS preflight ---------------------------------------------------
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi

# --- Helper: Execute AT command via qcmd, return stripped response -----------
strip_at_response() {
    printf '%s' "$1" | sed '1d' | sed '/^OK$/d' | sed '/^ERROR$/d' | tr -d '\r'
}

run_at() {
    local raw
    raw=$(qcmd "$1" 2>/dev/null)
    local rc=$?
    if [ $rc -ne 0 ] || [ -z "$raw" ]; then
        return 1
    fi
    case "$raw" in
        *ERROR*) return 1 ;;
    esac
    strip_at_response "$raw"
}

# --- Helper: JSON string escape ----------------------------------------------
_esc() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g'
}

# =============================================================================
# Query all settings (sip-don't-gulp)
# =============================================================================

qlog_info "Querying current modem settings for profile form"

# --- 1. APN profiles from AT+CGDCONT? ----------------------------------------
cgdcont_resp=$(run_at "AT+CGDCONT?")
sleep "$CMD_GAP"

# Parse: +CGDCONT: <cid>,"<pdp_type>","<apn>",...
# Build JSON array of {cid, pdp_type, apn}
# Uses awk to avoid pipe+while subshell issues with variable scoping.
if [ -n "$cgdcont_resp" ]; then
    apn_array=$(printf '%s' "$cgdcont_resp" | awk -F'"' '
        /\+CGDCONT:/ {
            # Field layout after splitting on ": +CGDCONT: <cid>, | <pdp> | , | <apn> | ...
            split($0, a, /[,]/)
            # First comma-field has "+CGDCONT: <cid>"
            gsub(/[^0-9]/, "", a[1])
            cid = a[1]
            pdp = $2    # first quoted string = pdp_type
            apn = $4    # second quoted string = apn
            if (cid != "") {
                if (n++) printf ","
                printf "{\"cid\":%s,\"pdp_type\":\"%s\",\"apn\":\"%s\"}", cid, pdp, apn
            }
        }
    ')
    apn_array="[${apn_array}]"
else
    apn_array="[]"
fi

# --- 2. Current IMEI from AT+CGSN --------------------------------------------
imei_resp=$(run_at "AT+CGSN")
current_imei=$(printf '%s' "$imei_resp" | grep -o '[0-9]\{15\}' | head -1)
sleep "$CMD_GAP"

# --- 3. Network mode from AT+QNWPREFCFG="mode_pref" -------------------------
mode_resp=$(run_at 'AT+QNWPREFCFG="mode_pref"')
current_mode=$(printf '%s' "$mode_resp" | sed -n 's/.*"mode_pref",\(.*\)/\1/p' | tr -d ' \r')
sleep "$CMD_GAP"

# --- 4. Current LTE bands ----------------------------------------------------
lte_resp=$(run_at 'AT+QNWPREFCFG="lte_band"')
current_lte=$(printf '%s' "$lte_resp" | sed -n 's/.*"lte_band",\(.*\)/\1/p' | tr -d ' \r')
sleep "$CMD_GAP"

# --- 5. Current NSA NR bands -------------------------------------------------
nsa_resp=$(run_at 'AT+QNWPREFCFG="nsa_nr5g_band"')
current_nsa=$(printf '%s' "$nsa_resp" | sed -n 's/.*"nsa_nr5g_band",\(.*\)/\1/p' | tr -d ' \r')
sleep "$CMD_GAP"

# --- 6. Current SA NR bands --------------------------------------------------
sa_resp=$(run_at 'AT+QNWPREFCFG="nr5g_band"')
current_sa=$(printf '%s' "$sa_resp" | sed -n 's/.*"nr5g_band",\(.*\)/\1/p' | tr -d ' \r')
sleep "$CMD_GAP"

# --- 7. Supported bands from policy_band (for band picker UI) ----------------
policy_resp=$(run_at 'AT+QNWPREFCFG="policy_band"')
supported_lte=$(printf '%s' "$policy_resp" | grep '"lte_band"' | sed -n 's/.*"lte_band",\(.*\)/\1/p' | tr -d ' \r')
supported_nsa=$(printf '%s' "$policy_resp" | grep '"nsa_nr5g_band"' | sed -n 's/.*"nsa_nr5g_band",\(.*\)/\1/p' | tr -d ' \r')
supported_sa=$(printf '%s' "$policy_resp" | grep '"nr5g_band"' | sed -n 's/.*"nr5g_band",\(.*\)/\1/p' | tr -d ' \r')

# =============================================================================
# Build and output response JSON
# =============================================================================

cat << RESP_EOF
{
  "apn_profiles": ${apn_array},
  "imei": "$(_esc "$current_imei")",
  "network_mode": "$(_esc "$current_mode")",
  "lte_bands": "$(_esc "$current_lte")",
  "nsa_nr_bands": "$(_esc "$current_nsa")",
  "sa_nr_bands": "$(_esc "$current_sa")",
  "supported_lte_bands": "$(_esc "$supported_lte")",
  "supported_nsa_nr_bands": "$(_esc "$supported_nsa")",
  "supported_sa_nr_bands": "$(_esc "$supported_sa")"
}
RESP_EOF

qlog_info "Current settings query complete"
