#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# activate.sh — CGI Endpoint: Activate Connection Scenario
# =============================================================================
# Applies a connection scenario's network mode and band locks to the modem.
# Synchronous — typically 1-4 AT commands (~200ms each), returns result.
#
# Default scenarios (balanced/gaming/streaming):
#   Only mode_pref is sent. Bands are left unchanged (user controls via
#   Band Locking page).
#   POST body: {"id":"gaming"}
#
# Custom scenarios (custom-*):
#   Mode + band locks sent from frontend config.
#   POST body: {"id":"custom-123","mode":"NR5G","lte_bands":"1:3:7",
#               "nsa_nr_bands":"41:78","sa_nr_bands":"41:78"}
#   Empty/missing band fields → AT command skipped (leave current setting).
#
# Guard: If the active SIM profile has a scenario_id binding, this endpoint
#   returns a profile_managed error and does NOT touch the modem. The frontend
#   is expected to gate the UI; this is defense-in-depth.
#
# Endpoint: POST /cgi-bin/quecmanager/scenarios/activate.sh
# Install location: /www/cgi-bin/quecmanager/scenarios/activate.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_scenario_activate"
cgi_headers
cgi_handle_options

# --- Source libraries --------------------------------------------------------
. /usr/lib/qmanager/scenario_mgr.sh
. /usr/lib/qmanager/profile_mgr.sh

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Parse JSON fields from POST body ----------------------------------------
SCENARIO_ID=$(printf '%s' "$POST_DATA" | jq -r '.id // empty')

if [ -z "$SCENARIO_ID" ]; then
    cgi_error "no_id" "Missing id field in request body"
    exit 0
fi

# --- Profile-managed guard ---------------------------------------------------
# If the active SIM profile has a scenario_id bound to it, the user cannot
# activate scenarios independently — the profile owns radio config.
ACTIVE_PROFILE_ID=$(get_active_profile)
if [ -n "$ACTIVE_PROFILE_ID" ]; then
    BOUND_SCENARIO=$(jq -r '.settings.scenario_id // empty' \
        "/etc/qmanager/profiles/${ACTIVE_PROFILE_ID}.json" 2>/dev/null)
    if [ -n "$BOUND_SCENARIO" ]; then
        cgi_error "profile_managed" "Scenarios are managed by the active SIM profile"
        exit 0
    fi
fi

# --- Validate scenario ID and parse custom fields ----------------------------
AT_MODE=""
LTE_BANDS=""
NSA_NR_BANDS=""
SA_NR_BANDS=""

case "$SCENARIO_ID" in
    balanced|gaming|streaming)
        # Built-in: no extra fields needed — scenario_apply resolves mode
        ;;
    custom-*)
        # Custom scenario: read config from POST body
        AT_MODE=$(printf '%s' "$POST_DATA" | jq -r '.mode // empty')
        LTE_BANDS=$(printf '%s' "$POST_DATA" | jq -r '.lte_bands // empty')
        NSA_NR_BANDS=$(printf '%s' "$POST_DATA" | jq -r '.nsa_nr_bands // empty')
        SA_NR_BANDS=$(printf '%s' "$POST_DATA" | jq -r '.sa_nr_bands // empty')

        if [ -z "$AT_MODE" ]; then
            cgi_error "no_mode" "Custom scenario requires mode field"
            exit 0
        fi

        # Validate band format: only digits and colons allowed (e.g., "1:3:28")
        for _band_field in "$LTE_BANDS" "$NSA_NR_BANDS" "$SA_NR_BANDS"; do
            if [ -n "$_band_field" ]; then
                _cleaned=$(printf '%s' "$_band_field" | tr -d '0-9:')
                if [ -n "$_cleaned" ]; then
                    cgi_error "invalid_bands" "Band values must contain only digits and colons"
                    exit 0
                fi
            fi
        done

        # Validate mode value
        case "$AT_MODE" in
            AUTO|LTE|NR5G|LTE:NR5G) ;;
            *)
                cgi_error "invalid_mode" "Invalid mode value"
                exit 0
                ;;
        esac
        ;;
    *)
        cgi_error "invalid_id" "Unknown scenario ID"
        exit 0
        ;;
esac

qlog_info "Activating scenario: $SCENARIO_ID (mode=$AT_MODE, lte=$LTE_BANDS, nsa=$NSA_NR_BANDS, sa=$SA_NR_BANDS)"

# --- Apply via library -------------------------------------------------------
if ! scenario_apply "$SCENARIO_ID" "$AT_MODE" "$LTE_BANDS" "$NSA_NR_BANDS" "$SA_NR_BANDS"; then
    cgi_error "modem_error" "Failed to set network mode"
    exit 0
fi

# --- Persist active scenario to flash ----------------------------------------
scenario_set_active "$SCENARIO_ID"

# --- Response ----------------------------------------------------------------
if [ -n "$_scenario_apply_failed" ]; then
    qlog_warn "Scenario activated with partial band lock failure: $_scenario_apply_failed"
    jq -n --arg id "$SCENARIO_ID" --arg detail "Band lock failed for: $_scenario_apply_failed" \
        '{"success":true,"id":$id,"warning":"partial_band_lock","detail":$detail}'
else
    qlog_info "Scenario activated: $SCENARIO_ID"
    jq -n --arg id "$SCENARIO_ID" '{"success":true,"id":$id}'
fi
