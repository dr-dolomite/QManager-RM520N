#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# speedtest_status.sh — CGI Endpoint: Speedtest Status / Progress
# =============================================================================
# Polls the current speedtest state. Returns one of:
#   - idle:     No test running, no cached result
#   - running:  Test in progress, includes current progress line
#   - complete: Test finished, includes full result
#   - error:    Something went wrong
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/speedtest_status.sh
#
# NOTE: The Ookla speedtest binary may output ASCII art / banners alongside
# its NDJSON progress lines. We MUST filter for lines starting with '{'
# rather than blindly reading tail -1.
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/speedtest_status.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_speedtest.pid"
OUTPUT_FILE="/tmp/qmanager_speedtest_output"
RESULT_FILE="/tmp/qmanager_speedtest_result.json"

qlog_init "cgi_speedtest_status"
cgi_headers
cgi_handle_options

# =============================================================================
# HELPERS
# =============================================================================

# Extract "type" field from a JSON line
get_type() {
    printf '%s' "$1" | jq -r '.type // empty'
}

# Get the last valid JSON line from the output file.
# Speedtest may interleave ASCII progress bars, banners, or blank lines
# between JSON objects. We only want lines that start with '{'.
get_last_json_line() {
    grep '^{' "$OUTPUT_FILE" 2>/dev/null | tail -1
}

# Get the result line specifically (may not be the very last line)
get_result_line() {
    grep '"type":"result"' "$OUTPUT_FILE" 2>/dev/null | tail -1
}

# =============================================================================
# STATE DETECTION
# =============================================================================

# Case 1: PID file exists — test may be running or just finished
if [ -f "$PID_FILE" ]; then
    SPEEDTEST_PID=$(cat "$PID_FILE" 2>/dev/null)

    if [ -n "$SPEEDTEST_PID" ] && kill -0 "$SPEEDTEST_PID" 2>/dev/null; then
        # =====================================================================
        # RUNNING — process is alive, grab latest JSON progress line
        # =====================================================================
        if [ -f "$OUTPUT_FILE" ] && [ -s "$OUTPUT_FILE" ]; then
            LAST_LINE=$(get_last_json_line)

            if [ -n "$LAST_LINE" ]; then
                LINE_TYPE=$(get_type "$LAST_LINE")

                # Determine phase from the type field
                case "$LINE_TYPE" in
                    testStart) PHASE="initializing" ;;
                    ping)      PHASE="ping" ;;
                    download)  PHASE="download" ;;
                    upload)    PHASE="upload" ;;
                    *)         PHASE="running" ;;
                esac
                jq -n --arg phase "$PHASE" --argjson progress "$LAST_LINE" \
                    '{status: "running", phase: $phase, progress: $progress}'
            else
                # Output file has content but no JSON lines yet (just banners)
                echo '{"status":"running","phase":"initializing","progress":null}'
            fi
        else
            # Process started but hasn't written output yet
            echo '{"status":"running","phase":"initializing","progress":null}'
        fi
        exit 0
    else
        # =================================================================
        # JUST FINISHED — process is dead, harvest result
        # =================================================================
        rm -f "$PID_FILE"

        if [ -f "$OUTPUT_FILE" ] && [ -s "$OUTPUT_FILE" ]; then
            # First try: look specifically for the result line
            RESULT_LINE=$(get_result_line)

            if [ -n "$RESULT_LINE" ]; then
                echo "$RESULT_LINE" > "$RESULT_FILE"
                jq -n --argjson result "$RESULT_LINE" '{status: "complete", result: $result}'
            else
                # No result line — check if last JSON line gives us anything
                LAST_LINE=$(get_last_json_line)
                LINE_TYPE=$(get_type "$LAST_LINE")

                if [ "$LINE_TYPE" = "result" ]; then
                    echo "$LAST_LINE" > "$RESULT_FILE"
                    jq -n --argjson result "$LAST_LINE" '{status: "complete", result: $result}'
                else
                    echo '{"status":"error","error":"speedtest_failed","detail":"Process exited without producing results"}'
                fi
            fi
            # Clean up the (potentially large) progress output file
            rm -f "$OUTPUT_FILE"
        else
            echo '{"status":"error","error":"speedtest_failed","detail":"Process exited with no output"}'
        fi
        exit 0
    fi
fi

# Case 2: No PID file — check for cached result from previous run
if [ -f "$RESULT_FILE" ] && [ -s "$RESULT_FILE" ]; then
    CACHED_RESULT=$(cat "$RESULT_FILE" 2>/dev/null)
    # Validate it's actually JSON before embedding
    case "$CACHED_RESULT" in
        "{"*)
            jq -n --argjson result "$CACHED_RESULT" '{status: "complete", result: $result}'
            ;;
        *)
            # Corrupted cache — discard it
            rm -f "$RESULT_FILE"
            echo '{"status":"idle"}'
            ;;
    esac
    exit 0
fi

# Case 3: Nothing — no test running, no previous result
echo '{"status":"idle"}'
