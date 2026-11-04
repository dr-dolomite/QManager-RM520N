#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# fetch_events.sh — CGI Endpoint for Recent Activities / Network Events
# =============================================================================
# Serves the network events NDJSON file as a JSON array to the frontend.
# Zero modem contact — reads from RAM only.
#
# The events file is NDJSON (one JSON object per line). This script converts
# it to a proper JSON array for the frontend.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_events.sh
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_events.sh
# =============================================================================

EVENTS_FILE="/tmp/qmanager_events.json"

# The on-disk ring holds MAX_EVENTS (300) so that a burst of radio churn cannot
# evict the outage a user is trying to diagnose. The dashboard only ever reads
# the newest 20 (use-recent-activities.ts) and renders 5, so serving the whole
# ring on a 10-second poll would be paying ~35KB a request for data nothing
# reads. Serve a slice comfortably deeper than the consumer needs instead.
EVENTS_SERVE_LIMIT=50

qlog_init "cgi_fetch_events"
cgi_headers
cgi_handle_options

serve_ndjson_as_array "$EVENTS_FILE" "$EVENTS_SERVE_LIMIT"
