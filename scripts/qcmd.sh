#!/bin/sh
# =============================================================================
# qcmd — QManager Gatekeeper
# =============================================================================
# The SINGLE entry point for ALL modem communication.
# Uses flock to serialize access to the modem's serial port.
#
# Usage:
#   qcmd "AT+COMMAND"          → Execute AT command, return raw result
#   qcmd -j "AT+COMMAND"       → Execute AT command, return JSON-wrapped result
#
# Install location: /usr/bin/qcmd
# Dependencies: sms_tool, flock, timeout (busybox)
# =============================================================================

# --- Configuration -----------------------------------------------------------
LOCK_FILE="/var/lock/qmanager.lock"
LOCK_FD=9
LONG_FLAG="/tmp/qmanager_long_running"
PID_FILE="/var/lock/qmanager.pid"
DEVICE="/dev/ttyUSB2"

SHORT_TIMEOUT=3        # seconds for normal AT commands
LONG_TIMEOUT=240       # seconds for AT+QSCAN and similar
LOCK_WAIT_SHORT=5      # seconds to wait for lock (normal commands)
LOCK_WAIT_LONG=10      # seconds to wait for lock (long commands)

# --- Parse Arguments ---------------------------------------------------------
JSON_MODE=0
if [ "$1" = "-j" ]; then
    JSON_MODE=1
    shift
fi

COMMAND="$1"

if [ -z "$COMMAND" ]; then
    echo '{"error":"no_command","detail":"Usage: qcmd [-j] \"AT+COMMAND\""}' >&2
    exit 1
fi

# --- Helper: JSON Output -----------------------------------------------------
# Outputs result as JSON if -j flag was passed, raw otherwise.
# Escapes special characters for valid JSON strings.
json_escape() {
    printf '%s' "$1" | sed \
        -e 's/\\/\\\\/g' \
        -e 's/"/\\"/g' \
        -e 's/\t/\\t/g' \
        -e ':a' -e 'N' -e '$!ba' \
        -e 's/\n/\\n/g' \
        -e 's/\r/\\r/g'
}

output_result() {
    local raw="$1"
    local err="$2"

    if [ "$JSON_MODE" -eq 1 ]; then
        if [ -n "$err" ]; then
            local escaped_err
            escaped_err=$(json_escape "$err")
            printf '{"success":false,"error":"%s","command":"%s"}\n' \
                "$escaped_err" "$COMMAND"
        else
            local escaped_raw
            escaped_raw=$(json_escape "$raw")
            printf '{"success":true,"response":"%s","command":"%s"}\n' \
                "$escaped_raw" "$COMMAND"
        fi
    else
        if [ -n "$err" ]; then
            echo "ERROR: $err" >&2
            exit 1
        else
            echo "$raw"
        fi
    fi
}

# --- Helper: Command Classification -----------------------------------------
# Returns 0 (true) if the command is a long-running command.
# Checked against a configurable list + hardcoded fallbacks.
is_long_command() {
    local cmd="$1"

    # Check configurable list first
    if [ -f /etc/qmanager/long_commands.list ]; then
        while IFS= read -r pattern; do
            # Skip comments and empty lines
            case "$pattern" in
                '#'*|'') continue ;;
            esac
            case "$cmd" in
                *"$pattern"*) return 0 ;;
            esac
        done < /etc/qmanager/long_commands.list
    fi

    # Hardcoded fallbacks
    case "$cmd" in
        *QSCAN*|*QSCANFREQ*|*QFOTADL*) return 0 ;;
        *) return 1 ;;
    esac
}

# --- Helper: Stale Lock Recovery ---------------------------------------------
# If the PID that held the lock is dead, the lock is stale. Clear and retry.
recover_stale_lock() {
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
            # Process is dead — stale lock
            rm -f "$PID_FILE"
            # Try to acquire again with a short wait
            if flock -w 2 $LOCK_FD; then
                return 0  # Successfully recovered
            fi
        fi
    fi
    return 1  # Could not recover
}

# --- Main Execution ----------------------------------------------------------

# Open the lock file descriptor
eval "exec ${LOCK_FD}>\"${LOCK_FILE}\""

if is_long_command "$COMMAND"; then
    # =========================================================================
    # LONG COMMAND PATH (AT+QSCAN, AT+QSCANFREQ, etc.)
    # =========================================================================
    # 1. Set the global flag BEFORE acquiring lock so the poller can yield
    # 2. Acquire lock with generous timeout
    # 3. Execute with long timeout
    # 4. Clean up flag + lock
    # =========================================================================

    echo "$COMMAND" > "$LONG_FLAG"

    if ! flock -w "$LOCK_WAIT_LONG" $LOCK_FD; then
        rm -f "$LONG_FLAG"
        output_result "" "modem_busy"
        exit 1
    fi

    echo $$ > "$PID_FILE"

    result=$(timeout "$LONG_TIMEOUT" sms_tool -d "$DEVICE" at "$COMMAND" 2>/dev/null)
    exit_code=$?

    # Release lock and clean up
    flock -u $LOCK_FD
    rm -f "$LONG_FLAG" "$PID_FILE"

    if [ $exit_code -ne 0 ]; then
        output_result "" "command_timeout"
        exit 1
    fi

    output_result "$result" ""

elif [ -f "$LONG_FLAG" ]; then
    # =========================================================================
    # LONG COMMAND IN PROGRESS — Reject immediately
    # =========================================================================
    # Don't queue behind a 2-3 minute scan. Fail fast.
    # =========================================================================

    output_result "" "scan_in_progress"
    exit 1

else
    # =========================================================================
    # SHORT COMMAND PATH (Normal AT commands)
    # =========================================================================
    # 1. Try to acquire lock
    # 2. On failure, attempt stale lock recovery
    # 3. Execute with short timeout
    # 4. Release lock
    # =========================================================================

    if ! flock -w "$LOCK_WAIT_SHORT" $LOCK_FD; then
        # Lock acquisition failed — try stale lock recovery
        if ! recover_stale_lock; then
            output_result "" "modem_busy"
            exit 1
        fi
    fi

    echo $$ > "$PID_FILE"

    result=$(timeout "$SHORT_TIMEOUT" sms_tool -d "$DEVICE" at "$COMMAND" 2>/dev/null)
    exit_code=$?

    # Release lock and clean up
    flock -u $LOCK_FD
    rm -f "$PID_FILE"

    if [ $exit_code -ne 0 ]; then
        output_result "" "command_timeout"
        exit 1
    fi

    output_result "$result" ""
fi
