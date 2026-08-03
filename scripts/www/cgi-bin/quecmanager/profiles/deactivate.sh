#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
# =============================================================================
# deactivate.sh — CGI Endpoint: Deactivate (Clear) Active SIM Profile
# =============================================================================
# Clears the active profile marker so no profile is shown as active, AND
# reverts CID 1's APN to carrier default (blank APN via the shared
# apn_apply_write primitive, allow_empty=1) — a profile-written APN must not
# outlive the profile.
#
# Ordering decision: REVERT THE APN FIRST, then clear profile state. If the
# modem revert fails partway (e.g. left deregistered — apn_apply_write's own
# rc=3/5 paths), the profile stays marked active and its scenario schedule
# stays armed, which is the more honest half-state: the modem truly is still
# on (or ambiguously on) the profile's settings, and the UI keeps showing it
# as active as a result. Clearing profile state FIRST and reverting the APN
# afterward would risk the opposite: an apply that failed leaves the UI
# reporting "no active profile" while the modem is still deregistered or
# still on the old profile's APN — a false "nothing to see here" that is
# harder to notice and diagnose than a profile that stays visibly active.
# A revert failure is reported honestly in the response (success:false) but
# does NOT abort the request before the profile-state cleanup is attempted
# in the success case — see below.
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
MAX_EVENTS=300
. /usr/lib/qmanager/events.sh 2>/dev/null || {
    append_event() { :; }
}
# Synchronous CGI ceiling: a human is waiting on this HTTP response, so this
# endpoint cannot afford apn_apply.sh's 30s unattended-worker lock-wait
# default (qmanager_profile_apply keeps that default — nothing is blocked on
# it, so it should win the retry). Must be set BEFORE sourcing apn_apply.sh:
# its APN_APPLY_LOCK_WAIT default-assignment only evaluates once, on first
# source.
APN_APPLY_LOCK_WAIT=5
. /usr/lib/qmanager/apn_apply.sh

# --- Fail closed if the shared attach-cycle primitive failed to load --------
# The APN revert below goes through apn_apply_write. A silent skip here
# would let a broken install proceed as if the revert succeeded (or skip it
# unnoticed) — hard-stop instead.
if ! command -v apn_apply_write >/dev/null 2>&1; then
    qlog_error "apn_apply.sh library missing or failed to load"
    cgi_error "internal_error" "apn_apply.sh library missing or failed to load"
    exit 0
fi

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

# --- Revert CID 1's APN to carrier default FIRST (see ordering note above) ---
# allow_empty=1: this is a deliberate revert, not a silently-missing APN.
# PDP type is fixed to IPV4V6 here — this endpoint has no per-profile PDP
# type to read (the active profile marker is being cleared, not looked up
# field-by-field), and IPV4V6 is the same default apply_apn/apn.sh fall back
# to elsewhere in this codebase.
apn_apply_write 1 "IPV4V6" "" 1
_apn_revert_rc="$APN_APPLY_RC"
_apn_revert_detail="$APN_APPLY_DETAIL"
if [ "$_apn_revert_rc" -ne 0 ]; then
    qlog_error "Profile deactivate: APN revert failed: $_apn_revert_detail"
    case "$_apn_revert_rc" in
        1) cgi_error "cgdcont_failed" "$_apn_revert_detail" ;;
        2) cgi_error "cops_detach_failed" "$_apn_revert_detail" ;;
        3) cgi_error "cops_attach_failed" "$_apn_revert_detail" ;;
        5) cgi_error "cops_attach_failed" "$_apn_revert_detail" ;;
        7) cgi_error "apn_busy" "$_apn_revert_detail" ;;
        *) cgi_error "apn_revert_failed" "$_apn_revert_detail" ;;
    esac
    exit 0
fi

# --- Clear active profile ----------------------------------------------------
clear_active_profile

# --- Tear down profile-scenario schedule + reset scenario to default ---------
# Deactivating a profile must not leave a systemd OnCalendar timer armed for
# its schedule (RM520N has no crond — scheduling is systemd OnCalendar, not
# cron), nor leave the radio locked to the profile's scenario. Mode-only
# reset: returns mode_pref to AUTO and writes active_scenario=balanced.
. /usr/lib/qmanager/scenario_mgr.sh 2>/dev/null
# Redirect is load-bearing, not tidiness: scenario_teardown_schedule wraps the
# qmanager_scenario_schedule_arm root helper, which prints a JSON object on
# every exit path ({"success":true,"armed":false}). Unredirected, that lands in
# this endpoint's HTTP body ahead of the cgi_success below, so the response is
# two concatenated JSON documents and no client can parse it. Nothing captures
# this output anywhere. (scenario_reset_to_default below writes only to the
# log, so it needs no redirect.)
if command -v scenario_teardown_schedule >/dev/null 2>&1; then
    scenario_teardown_schedule >/dev/null 2>&1
fi
if command -v scenario_reset_to_default >/dev/null 2>&1; then
    scenario_reset_to_default
fi

# --- Emit network event ------------------------------------------------------
if [ -n "$_deact_name" ]; then
    append_event "profile_deactivated" "Profile '$_deact_name' deactivated" "info"
fi

cgi_success
