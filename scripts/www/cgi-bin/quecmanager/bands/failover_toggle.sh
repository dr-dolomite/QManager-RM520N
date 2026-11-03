#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# failover_toggle.sh — CGI Endpoint: Toggle Band Failover
# =============================================================================
# Enables or disables the band failover safety mechanism. When enabled,
# a one-shot watcher is spawned after each band lock operation that reverts
# to all supported bands if the modem loses service within 15 seconds.
#
# The setting persists on flash (/etc/qmanager/band_failover_enabled).
#
# POST body:
#   {"enabled": true}   — enable failover
#   {"enabled": false}  — disable failover
#
# Endpoint: POST /cgi-bin/quecmanager/bands/failover_toggle.sh
# Install location: /www/cgi-bin/quecmanager/bands/failover_toggle.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_bands_failover"
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

# --- Parse enabled value -----------------------------------------------------
# Handle both "enabled":true and "enabled":"true" formats
ENABLED_VAL=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else empty end')

if [ -z "$ENABLED_VAL" ]; then
    cgi_error "no_enabled" "Missing or invalid enabled field (expected true or false)"
    exit 0
fi

# --- Persist setting ---------------------------------------------------------
bands_set_failover "$ENABLED_VAL"

if [ "$ENABLED_VAL" = "true" ]; then
    jq -n '{"success":true,"enabled":true}'
else
    jq -n '{"success":true,"enabled":false}'
fi
