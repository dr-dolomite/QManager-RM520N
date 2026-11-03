#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# lock.sh — CGI Endpoint: Apply Band Lock
# =============================================================================
# Locks bands for a single category (lte, nsa_nr5g, or sa_nr5g).
# Per-card operation — each band card sends its own independent lock request.
#
# POST body:
#   {"band_type":"lte","bands":"1:3:7:28"}
#   {"band_type":"nsa_nr5g","bands":"41:78"}
#   {"band_type":"sa_nr5g","bands":"41:78"}
#
# On success, clears any previous failover activation flag and spawns the
# failover watcher (if failover is enabled) to monitor connectivity.
#
# Endpoint: POST /cgi-bin/quecmanager/bands/lock.sh
# Install location: /www/cgi-bin/quecmanager/bands/lock.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_bands_lock"
cgi_headers
cgi_handle_options

# --- Libraries ---------------------------------------------------------------
. /usr/lib/qmanager/radio_validate.sh

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Parse JSON fields -------------------------------------------------------
BAND_TYPE=$(printf '%s' "$POST_DATA" | jq -r '.band_type // empty')
BANDS=$(printf '%s' "$POST_DATA" | jq -r '.bands // empty')

# --- Validate inputs ---------------------------------------------------------
if [ -z "$BAND_TYPE" ]; then
    cgi_error "no_band_type" "Missing band_type field"
    exit 0
fi

if [ -z "$BANDS" ]; then
    cgi_error "no_bands" "Missing bands field"
    exit 0
fi

# Validate band_type is one of the allowed values
if ! rv_band_type "$BAND_TYPE"; then
    cgi_error "invalid_band_type" "band_type must be lte, nsa_nr5g, or sa_nr5g"
    exit 0
fi
AT_PARAM="$RV_AT_PARAM"

# Validate bands format: must be colon-delimited numbers only
if ! rv_bands_format "$BANDS"; then
    cgi_error "invalid_bands" "bands must be colon-delimited numbers (e.g. 1:3:7:28)"
    exit 0
fi

# Reject bands the modem does not support (an unknown supported list passes).
case "$BAND_TYPE" in
    lte)      SUP_KEY="supported_lte_bands" ;;
    nsa_nr5g) SUP_KEY="supported_nsa_nr5g_bands" ;;
    *)        SUP_KEY="supported_sa_nr5g_bands" ;;
esac
SUPPORTED=$(jq -r ".device.$SUP_KEY // empty" /tmp/qmanager_status.json 2>/dev/null)
if ! rv_bands_supported "$BANDS" "$SUPPORTED"; then
    cgi_error "invalid_bands" "One or more bands are not supported by this modem"
    exit 0
fi

qlog_info "Band lock request: type=$BAND_TYPE param=$AT_PARAM bands=$BANDS"

# --- Send AT command ---------------------------------------------------------
if ! bands_lock_write "$AT_PARAM" "$BANDS"; then
    cgi_error "modem_error" "Failed to send band lock command"
    exit 0
fi

# --- Clear failover flag, respawn the watcher if failover is enabled ---------
bands_arm_failover
failover_armed="$BANDS_FAILOVER_ARMED"

# --- Response ----------------------------------------------------------------
jq -n --arg bt "$BAND_TYPE" --arg b "$BANDS" --argjson fa "$failover_armed" \
    '{"success":true,"band_type":$bt,"bands":$b,"failover_armed":$fa}'
