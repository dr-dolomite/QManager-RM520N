#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# deactivate.sh — CGI Endpoint: Deactivate (Clear) Active SIM Profile
# =============================================================================
# Clears the active profile marker so no profile is shown as active.
# Modem settings are NOT reverted — they persist in modem NVM. This only
# removes the "active" designation from the UI.
#
# Endpoint: POST /cgi-bin/quecmanager/profiles/deactivate.sh
# Request body: (none required)
# Response: {"success":true}
#       or: {"success":false,"error":"...","detail":"..."}
#
# Install location: /www/cgi-bin/quecmanager/profiles/deactivate.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_profile_deactivate"
cgi_headers
cgi_handle_options

# --- Source profile manager library ------------------------------------------
. /usr/lib/qmanager/profile_mgr.sh

# --- Events (for append_event) -----------------------------------------------
EVENTS_FILE="/tmp/qmanager_events.json"
MAX_EVENTS=50
. /usr/lib/qmanager/events.sh 2>/dev/null || {
    append_event() { :; }
}

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

qlog_info "Profile deactivate request"

# --- Look up profile name before clearing ------------------------------------
_deact_id=$(get_active_profile)
_deact_name=""
if [ -n "$_deact_id" ] && [ -f "$PROFILE_DIR/${_deact_id}.json" ]; then
    _deact_name=$(jq -r '.name // empty' "$PROFILE_DIR/${_deact_id}.json" 2>/dev/null)
fi

# --- Clear active profile ----------------------------------------------------
clear_active_profile

# --- Tear down profile-scenario schedule + reset scenario to default ---------
# Deactivating a profile must not leave a systemd OnCalendar timer armed for
# its schedule (RM520N has no crond — scheduling is systemd OnCalendar, not
# cron), nor leave the radio locked to the profile's scenario. Mode-only
# reset: returns mode_pref to AUTO and writes active_scenario=balanced.
. /usr/lib/qmanager/scenario_mgr.sh 2>/dev/null
if command -v scenario_teardown_schedule >/dev/null 2>&1; then
    scenario_teardown_schedule
fi
if command -v scenario_reset_to_default >/dev/null 2>&1; then
    scenario_reset_to_default
fi

# --- Emit network event ------------------------------------------------------
if [ -n "$_deact_name" ]; then
    append_event "profile_deactivated" "Profile '$_deact_name' deactivated" "info"
fi

cgi_success
