#!/bin/sh
# =============================================================================
# fetch_signal_history.sh — CGI Endpoint for Signal History Chart Data
# =============================================================================
# Serves the per-antenna signal history NDJSON file as a JSON array.
# Zero modem contact — reads from RAM only.
#
# The signal history file is NDJSON (one JSON object per line). This script
# converts it to a proper JSON array for the frontend.
#
# Each line format:
#   {"ts":1707900000,"lte_rsrp":[-95,-97,null,null],...}
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh
# =============================================================================

SIGNAL_HISTORY_FILE="/tmp/qmanager_signal_history.json"

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo ""

# --- Serve signal history as JSON array --------------------------------------
if [ -f "$SIGNAL_HISTORY_FILE" ] && [ -s "$SIGNAL_HISTORY_FILE" ]; then
    # Convert NDJSON (one object per line) to a JSON array
    echo "["
    awk 'NR>1{print prev","} {prev=$0} END{if(NR>0) print prev}' "$SIGNAL_HISTORY_FILE"
    echo "]"
else
    echo "[]"
fi
