#!/bin/sh
# =============================================================================
# fetch_data.sh — CGI Endpoint for Dashboard Data
# =============================================================================
# Serves the cached JSON state file to the frontend.
# Zero modem contact — reads from RAM only.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_data.sh
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_data.sh
# =============================================================================

CACHE_FILE="/tmp/qmanager_status.json"

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo ""

# --- Serve the cache ---------------------------------------------------------
if [ -f "$CACHE_FILE" ]; then
    cat "$CACHE_FILE"
else
    # Cache doesn't exist yet (poller hasn't started or first boot)
    cat << 'FALLBACK'
{
  "timestamp": 0,
  "system_state": "initializing",
  "modem_reachable": false,
  "last_successful_poll": 0,
  "errors": ["poller_not_started"],
  "network": {
    "type": "",
    "sim_slot": 1,
    "carrier": "",
    "service_status": "unknown"
  },
  "lte": { "state": "unknown", "band": "", "earfcn": null, "bandwidth": null, "pci": null, "rsrp": null, "rsrq": null, "sinr": null, "rssi": null },
  "nr": { "state": "unknown", "band": "", "arfcn": null, "pci": null, "rsrp": null, "rsrq": null, "sinr": null, "scs": null },
  "device": {
    "temperature": null, "cpu_usage": 0, "memory_used_mb": 0, "memory_total_mb": 0,
    "uptime_seconds": 0, "conn_uptime_seconds": 0,
    "firmware": "", "imei": "", "imsi": "", "iccid": "", "phone_number": ""
  },
  "traffic": { "rx_bytes_per_sec": 0, "tx_bytes_per_sec": 0, "total_rx_bytes": 0, "total_tx_bytes": 0 }
}
FALLBACK
fi
