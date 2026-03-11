#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# save.sh — CGI Endpoint: Create / Update Custom Connection Scenario
# =============================================================================
# Saves a custom scenario definition to persistent storage (flash).
# Each scenario is stored as an individual JSON file.
#
# If the JSON body contains an "id" field starting with "custom-", it updates.
# Otherwise, it generates a new ID with timestamp.
#
# Endpoint: POST /cgi-bin/quecmanager/scenarios/save.sh
# Request body: {
#   "id": "custom-..." (optional — omit for create),
#   "name": "My Scenario",
#   "description": "...",
#   "gradient": "from-violet-600 via-purple-600 to-indigo-700",
#   "config": {
#     "atModeValue": "AUTO",
#     "mode": "Auto",
#     "optimization": "Custom",
#     "lte_bands": "1:3:28",
#     "nsa_nr_bands": "",
#     "sa_nr_bands": ""
#   }
# }
# Response: {"success":true,"id":"custom-..."}
#
# Install location: /www/cgi-bin/quecmanager/scenarios/save.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
SCENARIOS_DIR="/etc/qmanager/scenarios"
MAX_SCENARIOS=20

qlog_init "cgi_scenario_save"
cgi_headers
cgi_handle_options

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Parse fields from JSON --------------------------------------------------
SCENARIO_ID=$(printf '%s' "$POST_DATA" | jq -r '.id // empty')
SCENARIO_NAME=$(printf '%s' "$POST_DATA" | jq -r '.name // empty')

# --- Validate name -----------------------------------------------------------
if [ -z "$SCENARIO_NAME" ]; then
    cgi_error "no_name" "Scenario name is required"
    exit 0
fi

# --- Create directory --------------------------------------------------------
mkdir -p "$SCENARIOS_DIR" 2>/dev/null

# --- Generate ID if creating new scenario ------------------------------------
IS_NEW=0
if [ -z "$SCENARIO_ID" ] || ! echo "$SCENARIO_ID" | grep -q "^custom-"; then
    # New scenario — generate a unique ID
    SCENARIO_ID="custom-$(date +%s)"
    IS_NEW=1
fi

# --- Sanitize ID (prevent path traversal) ------------------------------------
case "$SCENARIO_ID" in
    custom-[0-9]*)
        # Valid format
        ;;
    *)
        cgi_error "invalid_id" "Invalid scenario ID format"
        exit 0
        ;;
esac

# --- Check limit on new creation ---------------------------------------------
if [ "$IS_NEW" -eq 1 ]; then
    COUNT=$(ls "$SCENARIOS_DIR"/*.json 2>/dev/null | wc -l)
    if [ "$COUNT" -ge "$MAX_SCENARIOS" ]; then
        jq -n --argjson max "$MAX_SCENARIOS" \
            '{"success":false,"error":"limit_reached","detail":("Maximum " + ($max | tostring) + " custom scenarios allowed")}'
        exit 0
    fi
fi

# --- Ensure the stored JSON has the correct ID --------------------------------
# Use jq to set the id field (handles both insert and replace safely)
SAVE_DATA=$(printf '%s' "$POST_DATA" | jq --arg id "$SCENARIO_ID" '.id = $id')

# --- Write to file ------------------------------------------------------------
SCENARIO_FILE="$SCENARIOS_DIR/${SCENARIO_ID}.json"
printf '%s' "$SAVE_DATA" > "$SCENARIO_FILE"

if [ $? -ne 0 ]; then
    cgi_error "write_failed" "Failed to write scenario file"
    exit 0
fi

jq -n --arg id "$SCENARIO_ID" '{"success":true,"id":$id}'
