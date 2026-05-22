#!/bin/sh
# =============================================================================
# scenario_mgr.sh — QManager Connection Scenario Manager Library
# =============================================================================
# A sourceable library providing scenario activation primitives used by both
# the activate.sh CGI and the qmanager_profile_apply pipeline.
#
# This is a LIBRARY — no persistent process, no polling.
#
# Dependencies: qlog_* functions (from qlog.sh), qcmd
# Install location: /usr/lib/qmanager/scenario_mgr.sh
#
# Usage:
#   . /usr/lib/qmanager/scenario_mgr.sh
#   scenario_apply "gaming"
#   scenario_set_active "gaming"
# =============================================================================

[ -n "$_SCENARIO_MGR_LOADED" ] && return 0
_SCENARIO_MGR_LOADED=1

# --- Configuration -----------------------------------------------------------
# Custom scenarios are stored under /etc/qmanager/scenarios/<id>.json
# (confirmed from scenarios/save.sh: SCENARIOS_DIR="/etc/qmanager/scenarios")
SCENARIO_DIR="/etc/qmanager/scenarios"
ACTIVE_SCENARIO_FILE="/etc/qmanager/active_scenario"

# --- Logging stubs (defensive — caller may not have sourced qlog.sh) ---------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init()  { :; }
    qlog_debug() { :; }
    qlog_info()  { :; }
    qlog_warn()  { :; }
    qlog_error() { :; }
}

# =============================================================================
# Active Scenario State Management
# =============================================================================

# scenario_get_active
# Print the currently active scenario ID, or empty if none is set.
scenario_get_active() {
    if [ -f "$ACTIVE_SCENARIO_FILE" ]; then
        cat "$ACTIVE_SCENARIO_FILE" 2>/dev/null | tr -d ' \n\r'
    fi
}

# scenario_set_active <id>
# Write the active scenario ID to flash (atomic).
scenario_set_active() {
    local id="$1"
    [ -z "$id" ] && return 1
    local dir
    dir=$(dirname "$ACTIVE_SCENARIO_FILE")
    mkdir -p "$dir" 2>/dev/null
    printf '%s' "$id" > "${ACTIVE_SCENARIO_FILE}.tmp" || return 1
    mv "${ACTIVE_SCENARIO_FILE}.tmp" "$ACTIVE_SCENARIO_FILE"
}

# scenario_clear_active
# Remove the active scenario marker.
scenario_clear_active() {
    rm -f "$ACTIVE_SCENARIO_FILE"
}

# =============================================================================
# Custom Scenario Lookup
# =============================================================================

# scenario_lookup_custom <id>
# For a custom-* ID, print the stored JSON to stdout.
# Returns 1 if the file does not exist.
scenario_lookup_custom() {
    local id="$1"
    local file="${SCENARIO_DIR}/${id}.json"
    if [ ! -f "$file" ]; then
        qlog_warn "scenario_lookup_custom: not found: $id"
        return 1
    fi
    cat "$file"
}

# =============================================================================
# AT Command Primitive
# =============================================================================

# _scenario_send_at <at_cmd> <label>
# Send one AT command via qcmd. Returns 0 on success, 1 on error.
# Not exported as a public function — used only within this library.
_scenario_send_at() {
    local cmd="$1"
    local label="$2"

    local result
    result=$(qcmd "$cmd" 2>/dev/null)
    local rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "scenario: $label: AT command failed (rc=$rc): $cmd"
        return 1
    fi

    case "$result" in
        *ERROR*)
            qlog_error "scenario: $label: AT returned ERROR: $cmd -> $result"
            return 1
            ;;
    esac

    qlog_info "scenario: $label: OK"
    return 0
}

# =============================================================================
# Unified Apply Primitive
# =============================================================================

# scenario_apply <id> [mode] [lte_bands] [nsa_nr_bands] [sa_nr_bands]
#
# Applies a scenario's network mode and optional band locks to the modem.
#
# For built-in scenarios (balanced/gaming/streaming):
#   - Extra args are ignored; the hardcoded mode_pref is used.
#   - Band locks are NOT sent (user controls bands via Band Locking page).
#
# For custom-* scenarios:
#   - Caller MUST provide mode. Band args may be empty (skips those AT commands).
#   - Caller resolves the JSON via scenario_lookup_custom before calling.
#
# Return values:
#   0 — full success (mode set, all provided band locks set)
#   1 — mode_pref AT command failed (hard failure)
#
# Side effects:
#   _scenario_apply_failed — set to comma-separated list of failed band
#   sub-steps if any band lock AT commands failed; empty on clean success.
#   Callers should check this after a 0 return to detect partial success.
#
# Usage:
#   scenario_apply "gaming"
#   scenario_apply "custom-1234" "NR5G" "1:3:28" "" ""
scenario_apply() {
    local id="$1"
    local mode="$2"
    local lte_bands="$3"
    local nsa_nr_bands="$4"
    local sa_nr_bands="$5"

    _scenario_apply_failed=""

    # --- Resolve mode for built-in scenarios ---------------------------------
    case "$id" in
        balanced)
            mode="AUTO"
            lte_bands=""
            nsa_nr_bands=""
            sa_nr_bands=""
            ;;
        gaming)
            mode="NR5G"
            lte_bands=""
            nsa_nr_bands=""
            sa_nr_bands=""
            ;;
        streaming)
            mode="LTE:NR5G"
            lte_bands=""
            nsa_nr_bands=""
            sa_nr_bands=""
            ;;
        custom-*)
            # Caller provides mode and bands — validate mode is not empty
            if [ -z "$mode" ]; then
                qlog_error "scenario_apply: custom scenario requires mode arg: $id"
                return 1
            fi
            ;;
        *)
            qlog_error "scenario_apply: unknown scenario id: $id"
            return 1
            ;;
    esac

    qlog_info "scenario_apply: $id (mode=$mode, lte=$lte_bands, nsa=$nsa_nr_bands, sa=$sa_nr_bands)"

    # --- Step 1: Set network mode (required) ---------------------------------
    if ! _scenario_send_at "AT+QNWPREFCFG=\"mode_pref\",${mode}" "mode_pref"; then
        return 1
    fi

    # --- Step 2: Band locks (optional — only custom scenarios pass these) ----
    if [ -n "$lte_bands" ]; then
        sleep 0.2
        if ! _scenario_send_at "AT+QNWPREFCFG=\"lte_band\",${lte_bands}" "lte_band"; then
            _scenario_apply_failed="lte_band"
        fi
    fi

    if [ -n "$nsa_nr_bands" ]; then
        sleep 0.2
        if ! _scenario_send_at "AT+QNWPREFCFG=\"nsa_nr5g_band\",${nsa_nr_bands}" "nsa_nr5g_band"; then
            _scenario_apply_failed="${_scenario_apply_failed:+${_scenario_apply_failed},}nsa_nr5g_band"
        fi
    fi

    if [ -n "$sa_nr_bands" ]; then
        sleep 0.2
        if ! _scenario_send_at "AT+QNWPREFCFG=\"nr5g_band\",${sa_nr_bands}" "nr5g_band"; then
            _scenario_apply_failed="${_scenario_apply_failed:+${_scenario_apply_failed},}nr5g_band"
        fi
    fi

    return 0
}
