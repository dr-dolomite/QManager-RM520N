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
LOCK_FILE="/tmp/qmanager_speedtest.lock"

qlog_init "cgi_speedtest_status"
cgi_headers
cgi_handle_options

# Lazily create the lock file — the fd redirect below fails if it's absent.
[ -e "$LOCK_FILE" ] || : > "$LOCK_FILE" 2>/dev/null

# speedtest_flock_wait <fd> <timeout_seconds>
# BusyBox flock has no -w/--timeout (verified live on-device: `flock -w 5`
# errors "invalid option -- 'w'"). Poll `flock -x -n` in a loop instead,
# matching the proven idiom in sim_registry.sh / cgi_auth.sh / sms.sh.
#
# Fractional sleep IS supported here — verified live on-device this session
# (`sleep 0.2 && echo OK` succeeds under BusyBox v1.31.1). That granularity
# is worth having rather than whole-second ticks: only the LOSING poller
# waits, and with two consumers (the dialog and the dashboard tile) one of
# them loses routinely at exactly the moment the result lands. At 1s ticks
# that poller could sit 3s before returning a benign "running" and only see
# the result on its next 500ms retry; at 0.2s the same 3s safety budget
# costs it ~1.1s instead. Returns 1 on timeout — the caller decides the
# fallback response, this never invents one.
speedtest_flock_wait() {
    _fd="$1"; _wait="$2"; _tries=$((_wait * 5)); _n=0
    while [ "$_n" -lt "$_tries" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then return 0; fi
        sleep 0.2
        _n=$((_n + 1))
    done
    return 1
}

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

    if pid_alive "$SPEEDTEST_PID"; then
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
        # JUST FINISHED — process is dead, harvest result.
        #
        # This is the destructive section (rm's PID_FILE/OUTPUT_FILE, writes
        # RESULT_FILE) and the one two concurrent pollers can race: poller A
        # can rm OUTPUT_FILE here while poller B is between its own [ -s ]
        # check and its own read, turning a successful test into a false
        # "speedtest_failed" for B. Serialize the whole harvest behind an
        # exclusive, short-timeout flock so only one poller ever harvests;
        # a poller that loses the race gets a benign "running" instead of
        # inventing an error (the frontend just polls again in 500ms).
        # =================================================================
        (
            if speedtest_flock_wait 9 3; then
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

                # PID file goes LAST, deliberately. Removing it first would end
                # the harvest for everyone else: a second poller that arrives
                # mid-harvest would find no PID file, skip this branch and the
                # lock with it, fall through to the cached-result case before
                # RESULT_FILE has been written, and report "idle" — so a
                # finishing test would flicker running -> idle -> complete.
                # Holding it until the result is durable keeps late pollers in
                # Case 1, where the lock gives them a benign "running". It also
                # survives a crash mid-harvest: the PID file remains, so the
                # next poller simply retries instead of losing the run.
                rm -f "$PID_FILE"
            else
                # Lock timed out — another poller is harvesting this exact
                # result right now. Never fabricate "error" or "idle" here;
                # a running-shaped response keeps the caller polling.
                echo '{"status":"running"}'
            fi
        ) 9<"$LOCK_FILE"
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
