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
# Endpoint: POST /cgi-bin/quecmanager/scenarios/activate.sh
# Install location: /www/cgi-bin/quecmanager/scenarios/activate.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_scenario_activate"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
ACTIVE_SCENARIO_FILE="/etc/qmanager/active_scenario"

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

# --- Helper: send AT command via qcmd, check response ------------------------
send_at() {
    local cmd="$1"
    local label="$2"

    local result
    result=$(qcmd "$cmd" 2>/dev/null)
    local rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "$label: AT command failed (rc=$rc): $cmd"
        return 1
    fi

    case "$result" in
        *ERROR*)
            qlog_error "$label: AT returned ERROR: $cmd -> $result"
            return 1
            ;;
    esac

    qlog_info "$label: OK"
    return 0
}

# --- Map scenario ID to AT commands ------------------------------------------
AT_MODE=""
LTE_BANDS=""
NSA_NR_BANDS=""
SA_NR_BANDS=""

case "$SCENARIO_ID" in
    balanced)
        AT_MODE="AUTO"
        ;;
    gaming)
        AT_MODE="NR5G"
        ;;
    streaming)
        AT_MODE="LTE:NR5G"
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

# --- Step 1: Set network mode ------------------------------------------------
FAILED=""

if ! send_at "AT+QNWPREFCFG=\"mode_pref\",${AT_MODE}" "mode_pref"; then
    cgi_error "modem_error" "Failed to set network mode"
    exit 0
fi

# --- Step 2: Set band locks (custom scenarios only, skip empty) ---------------
if [ -n "$LTE_BANDS" ]; then
    sleep 0.2
    if ! send_at "AT+QNWPREFCFG=\"lte_band\",${LTE_BANDS}" "lte_band"; then
        FAILED="lte_band"
    fi
fi

if [ -n "$NSA_NR_BANDS" ]; then
    sleep 0.2
    if ! send_at "AT+QNWPREFCFG=\"nsa_nr5g_band\",${NSA_NR_BANDS}" "nsa_nr5g_band"; then
        FAILED="${FAILED:+$FAILED,}nsa_nr5g_band"
    fi
fi

if [ -n "$SA_NR_BANDS" ]; then
    sleep 0.2
    if ! send_at "AT+QNWPREFCFG=\"nr5g_band\",${SA_NR_BANDS}" "nr5g_band"; then
        FAILED="${FAILED:+$FAILED,}nr5g_band"
    fi
fi

# --- Persist active scenario to flash ----------------------------------------
mkdir -p "$(dirname "$ACTIVE_SCENARIO_FILE")" 2>/dev/null
printf '%s' "$SCENARIO_ID" > "$ACTIVE_SCENARIO_FILE"

# --- Response -----------------------------------------------------------------
if [ -n "$FAILED" ]; then
    qlog_warn "Scenario activated with partial band lock failure: $FAILED"
    jq -n --arg id "$SCENARIO_ID" --arg detail "Band lock failed for: $FAILED" \
        '{"success":true,"id":$id,"warning":"partial_band_lock","detail":$detail}'
else
    qlog_info "Scenario activated: $SCENARIO_ID"
    jq -n --arg id "$SCENARIO_ID" '{"success":true,"id":$id}'
fi
