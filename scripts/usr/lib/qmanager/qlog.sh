#!/bin/sh
# =============================================================================
# qlog.sh — QManager Centralized Logging Library
# =============================================================================
# A sourceable logging library for all QManager shell scripts.
# Provides structured logging with levels, rotation, and dual output
# (file + syslog).
#
# Usage:
#   . /usr/lib/qmanager/qlog.sh          # Source the library
#   qlog_init "component_name"            # Initialize with component name
#   qlog_debug "Some debug message"       # Log at DEBUG level
#   qlog_info  "Some info message"        # Log at INFO level
#   qlog_warn  "Some warning"             # Log at WARN level
#   qlog_error "Some error"               # Log at ERROR level
#
# Environment Variables (optional overrides):
#   QLOG_LEVEL       — Minimum log level: DEBUG|INFO|WARN|ERROR (default: INFO)
#   QLOG_FILE        — Log file path (default: /tmp/qmanager.log)
#   QLOG_MAX_SIZE_KB — Max log file size in KB before rotation (default: 256)
#   QLOG_MAX_FILES   — Number of rotated files to keep (default: 2)
#   QLOG_TO_SYSLOG   — Also log to syslog: 1|0 (default: 1)
#   QLOG_TO_STDOUT   — Also log to stdout: 1|0 (default: 0)
#
# Install location: /usr/lib/qmanager/qlog.sh
# =============================================================================

[ -n "$_QLOG_LOADED" ] && return 0
_QLOG_LOADED=1

# --- Configuration (defaults, overridable via environment) -------------------
QLOG_LEVEL="${QLOG_LEVEL:-INFO}"
QLOG_FILE="${QLOG_FILE:-/tmp/qmanager.log}"
QLOG_MAX_SIZE_KB="${QLOG_MAX_SIZE_KB:-256}"
QLOG_MAX_FILES="${QLOG_MAX_FILES:-2}"
QLOG_TO_SYSLOG="${QLOG_TO_SYSLOG:-1}"
QLOG_TO_STDOUT="${QLOG_TO_STDOUT:-0}"

# Internal state
_QLOG_COMPONENT=""
_QLOG_INITIALIZED=0

# --- Level Constants ---------------------------------------------------------
_QLOG_LVL_DEBUG=0
_QLOG_LVL_INFO=1
_QLOG_LVL_WARN=2
_QLOG_LVL_ERROR=3

# --- Initialize --------------------------------------------------------------
# Must be called once before logging. Sets the component name used in log lines.
#
# Args:
#   $1 — Component name (e.g., "qcmd", "poller", "cgi_terminal")
# =============================================================================
qlog_init() {
    _QLOG_COMPONENT="${1:-unknown}"
    _QLOG_INITIALIZED=1

    # Ensure log directory exists (should be /tmp/ which always exists)
    local log_dir
    log_dir=$(dirname "$QLOG_FILE")
    [ -d "$log_dir" ] || mkdir -p "$log_dir" 2>/dev/null
}

# --- Level Resolver ----------------------------------------------------------
# Converts a level string to its numeric value for comparison.
_qlog_level_num() {
    case "$1" in
        DEBUG) echo $_QLOG_LVL_DEBUG ;;
        INFO)  echo $_QLOG_LVL_INFO ;;
        WARN)  echo $_QLOG_LVL_WARN ;;
        ERROR) echo $_QLOG_LVL_ERROR ;;
        *)     echo $_QLOG_LVL_INFO ;;
    esac
}

# --- Log Rotation ------------------------------------------------------------
# Checks file size and rotates if over the limit.
# Keeps QLOG_MAX_FILES rotated copies (e.g., .log.1, .log.2).
# Rotation is intentionally simple — no compression (RAM disk, not worth it).
_qlog_rotate() {
    [ ! -f "$QLOG_FILE" ] && return

    # Get file size in KB
    local size_kb=0
    if [ -f "$QLOG_FILE" ]; then
        # Portable: use wc -c for byte count, convert to KB
        local size_bytes
        size_bytes=$(wc -c < "$QLOG_FILE" 2>/dev/null)
        size_kb=$((size_bytes / 1024))
    fi

    if [ "$size_kb" -ge "$QLOG_MAX_SIZE_KB" ] 2>/dev/null; then
        # Rotate: shift existing rotated files
        local i=$QLOG_MAX_FILES
        while [ "$i" -gt 1 ]; do
            local prev=$((i - 1))
            [ -f "${QLOG_FILE}.${prev}" ] && mv "${QLOG_FILE}.${prev}" "${QLOG_FILE}.${i}"
            i=$((i - 1))
        done

        # Move current log to .1
        mv "$QLOG_FILE" "${QLOG_FILE}.1"

        # Start fresh
        : > "$QLOG_FILE"

        # Re-assert the shared mode. /tmp/qmanager.log is seeded root:root 0666
        # by qmanager_setup precisely so BOTH root daemons and www-data CGI can
        # append to it; /tmp is root-owned mode 1777 with fs.protected_regular=1,
        # and root-owned-in-a-root-owned-dir is the only ownership under which
        # both UIDs may open it for write.
        #
        # The `mv` above breaks that when ROOT rotates: rename() moves the seeded
        # inode out to .1 and `: >` creates a BRAND NEW one at root's umask 0022,
        # i.e. 0644. From that moment www-data's appends are denied — and
        # _qlog_write redirects with `>> ... 2>/dev/null`, so the loss is totally
        # silent. Since the poller is the highest-volume logger, root wins the
        # rotation almost every time, which would quietly re-introduce exactly
        # the missing-warning blindness the shared seed exists to prevent.
        #
        # When WWW-DATA rotates, the `mv` fails first (sticky /tmp: it does not
        # own the root-owned log), but `: >` still truncates THROUGH the existing
        # inode, so ownership and mode survive and this chmod is a harmless
        # no-op-or-EPERM. Either way the seed is preserved.
        chmod 666 "$QLOG_FILE" 2>/dev/null
    fi
}

# --- Core Log Writer ---------------------------------------------------------
# Formats and writes a log entry. Called by level-specific functions.
#
# Args:
#   $1 — Level string (DEBUG, INFO, WARN, ERROR)
#   $2 — Message
# =============================================================================
_qlog_write() {
    local level="$1"
    local message="$2"

    # Check if this level should be logged
    local msg_level_num
    msg_level_num=$(_qlog_level_num "$level")
    local cfg_level_num
    cfg_level_num=$(_qlog_level_num "$QLOG_LEVEL")

    if [ "$msg_level_num" -lt "$cfg_level_num" ] 2>/dev/null; then
        return
    fi

    # Format timestamp — ISO-ish for readability, compact for space
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%s')

    # Padded level for alignment
    local padded_level
    case "$level" in
        DEBUG) padded_level="DEBUG" ;;
        INFO)  padded_level="INFO " ;;
        WARN)  padded_level="WARN " ;;
        ERROR) padded_level="ERROR" ;;
        *)     padded_level="$level" ;;
    esac

    # Build the log line
    # Format: [TIMESTAMP] LEVEL [COMPONENT:PID] Message
    local line="[${ts}] ${padded_level} [${_QLOG_COMPONENT}:$$] ${message}"

    # Write to file (with rotation check)
    _qlog_rotate
    echo "$line" >> "$QLOG_FILE" 2>/dev/null

    # Optionally write to syslog
    if [ "$QLOG_TO_SYSLOG" = "1" ]; then
        local syslog_priority
        case "$level" in
            DEBUG) syslog_priority="daemon.debug" ;;
            INFO)  syslog_priority="daemon.info" ;;
            WARN)  syslog_priority="daemon.warn" ;;
            ERROR) syslog_priority="daemon.err" ;;
            *)     syslog_priority="daemon.info" ;;
        esac
        logger -t "qm_${_QLOG_COMPONENT}" -p "$syslog_priority" "$message" 2>/dev/null
    fi

    # Optionally write to stdout
    if [ "$QLOG_TO_STDOUT" = "1" ]; then
        echo "$line"
    fi
}

# --- Public Logging Functions ------------------------------------------------
qlog_debug() { _qlog_write "DEBUG" "$1"; }
qlog_info()  { _qlog_write "INFO"  "$1"; }
qlog_warn()  { _qlog_write "WARN"  "$1"; }
qlog_error() { _qlog_write "ERROR" "$1"; }

# --- Utility: Log AT Command + Response (for debugging) ----------------------
# Logs an AT command and its response at DEBUG level, truncating long responses.
#
# Args:
#   $1 — AT command string
#   $2 — Response string
#   $3 — Exit code (optional)
# =============================================================================
qlog_at_cmd() {
    local cmd="$1"
    local response="$2"
    local exit_code="${3:-0}"

    # Truncate response for logging (first 200 chars)
    local truncated
    if [ ${#response} -gt 200 ]; then
        truncated="$(printf '%s' "$response" | cut -c1-200)...[truncated]"
    else
        truncated="$response"
    fi

    # Replace newlines with ↵ for single-line log readability
    truncated=$(echo "$truncated" | tr '\n' '↵' | tr -d '\r')

    if [ "$exit_code" -eq 0 ]; then
        qlog_debug "AT_CMD: ${cmd} → ${truncated}"
    else
        qlog_warn "AT_CMD_FAIL: ${cmd} → exit=${exit_code} ${truncated}"
    fi
}

# --- Utility: Log Lock Events ------------------------------------------------
# Logs flock acquire/release/timeout events. Useful for debugging contention.
#
# Args:
#   $1 — Event: "acquire", "release", "timeout", "stale_recovery"
#   $2 — Extra detail (optional)
# =============================================================================
qlog_lock() {
    local event="$1"
    local detail="$2"

    case "$event" in
        acquire)        qlog_debug "LOCK: Acquired${detail:+ ($detail)}" ;;
        release)        qlog_debug "LOCK: Released${detail:+ ($detail)}" ;;
        timeout)        qlog_warn  "LOCK: Timeout waiting for lock${detail:+ ($detail)}" ;;
        stale_recovery) qlog_warn  "LOCK: Stale lock recovered (dead PID: ${detail})" ;;
        blocked)        qlog_debug "LOCK: Blocked by long command${detail:+ ($detail)}" ;;
        *)              qlog_debug "LOCK: ${event}${detail:+ ($detail)}" ;;
    esac
}

# --- Utility: Log State Transitions ------------------------------------------
# Logs changes in system/network state for diagnostics.
#
# Args:
#   $1 — Field name (e.g., "system_state", "network_type")
#   $2 — Old value
#   $3 — New value
# =============================================================================
qlog_state_change() {
    local field="$1"
    local old_val="$2"
    local new_val="$3"

    if [ "$old_val" != "$new_val" ]; then
        qlog_info "STATE: ${field}: ${old_val} → ${new_val}"
    fi
}
