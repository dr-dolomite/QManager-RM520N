#!/bin/sh
# units.sh — Public, unauthenticated unit-preference endpoint.
# Returns the user's temperature/distance unit preference so the pre-auth
# splash screen can render signal/temperature figures in the right unit
# before login. Unit prefs are non-sensitive (celsius|fahrenheit, km|miles).
#
# This is part of the UNAUTH attack surface alongside public/overview.sh and
# public/hostname.sh. The entire contract is these two string fields; do not
# add fields here without a security review — /etc/qmanager/qmanager.conf
# holds other, non-public settings in the same [settings] section.
#
# Mirrors the read path of system/settings.sh (GET) exactly: same config
# helper (config.sh / qm_config_get), same keys, same defaults.
#
# Endpoint: GET /cgi-bin/quecmanager/public/units.sh
# Response: application/json  ->  { "settings": { "temp_unit": "...", "distance_unit": "..." } }
#
# Install location: /usrdata/qmanager/www/cgi-bin/quecmanager/public/units.sh

_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
qlog_init "cgi_public_units"
cgi_headers
cgi_handle_options

# GET only — this is a read-only config projection, no other method is valid.
if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
    exit 0
fi

# NOTE: deliberately do NOT call qm_config_init here — it writes a default
# config file to /etc/qmanager/qmanager.conf if one is missing, and this is
# an unauthenticated public endpoint (zero file writes, hard constraint).
# qm_config_get already degrades gracefully to the given default when the
# config file doesn't exist (config.sh:73), so a plain read is sufficient.
TEMP_UNIT=$(qm_config_get settings temp_unit "celsius")
DIST_UNIT=$(qm_config_get settings distance_unit "km")

jq -n --arg t "$TEMP_UNIT" --arg d "$DIST_UNIT" '{settings:{temp_unit:$t, distance_unit:$d}}'
