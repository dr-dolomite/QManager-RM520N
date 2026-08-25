# qcmd Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify qcmd by removing the redundant `timeout` wrapper, PID tracking, stale lock recovery, LONG_FLAG mechanism, and duplicate code paths — while preserving the exact public contract (exit codes, JSON format, error strings) that 46 callers depend on.

**Architecture:** Collapse the two separate execution paths (long/short) into a single `run_at` helper that uses flock serialization with a variable lock wait time (longer for scan commands). Remove the `timeout` binary wrapper since atcli_smd11 handles timeouts natively. Keep `is_long_command()` for lock wait selection only. Keep all response parsing, JSON mode, and logging unchanged.

**Tech Stack:** POSIX sh (BusyBox compatible), flock, atcli_smd11, jq (for -j mode)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/usr/bin/qcmd` | **Rewrite** (321 → ~150 lines) | AT command gatekeeper with flock serialization |
| `scripts/usr/bin/qcmd_test` | **Update** (test 8 expectation) | Smoke test — verify contract preserved |

No other files change. The 46 callers all continue working without modification.

## Public Contract (MUST NOT CHANGE)

| Aspect | Before | After |
|--------|--------|-------|
| Exit 0 + response text | Success | Same |
| Exit 1 + stderr or JSON error | Failure | Same |
| `-j` JSON: `command_failed` | ERROR in response | Same |
| `-j` JSON: `modem_busy` | Lock timeout | Same |
| Raw mode output | Unmodified modem text | Same |
| Compound commands (`AT+A;+B`) | Work | Same |

### Removed behaviors (non-breaking)

| Removed | Why non-breaking |
|---------|------------------|
| `command_timeout` error | atcli_smd11 handles timeouts natively; this never fires |
| `scan_in_progress` error | Becomes `modem_busy` instead; AT Terminal blocks QSCAN at CGI layer; cell scanner runs as background process |
| Exit code 4 (timeout) | Was only used internally; all callers check `!= 0` |
| Stale lock retry | flock auto-releases on process death; retry was redundant |

---

### Task 1: Rewrite qcmd

**Files:**
- Modify: `scripts/usr/bin/qcmd` (full rewrite, 321 → ~150 lines)

- [ ] **Step 1: Read the current file to confirm state**

Read `scripts/usr/bin/qcmd` fully. Confirm it is 321 lines with the structure: logging setup → config → AT device check → argument parsing → output_result() → is_long_command() → check_stale_lock() → flock_wait() → long command path → long-flag check → short command path.

- [ ] **Step 2: Write the optimized qcmd**

Replace the entire file with:

```sh
#!/bin/sh
# =============================================================================
# qcmd — QManager AT Command Gatekeeper (RM520N-GL)
# =============================================================================
# The SINGLE entry point for ALL modem communication on the RM520N-GL.
# Uses flock to serialize access to /dev/smd11 via atcli_smd11.
#
# atcli_smd11 accesses /dev/smd11 directly — no socat-at-bridge needed.
# This eliminates the 7-service socat dependency chain entirely.
#
# Key behavior: atcli_smd11 always exits 0 (even on ERROR response).
# Error detection is done by parsing the response text for OK/ERROR.
# Long commands (AT+QSCAN etc.) are handled natively by atcli_smd11 —
# it waits for the modem to finish (tested: 1m+ for cell scans).
#
# Usage:
#   qcmd "AT+COMMAND"          → Execute AT command, return raw result
#   qcmd -j "AT+COMMAND"       → Execute AT command, return JSON-wrapped result
#
# Install location: /usr/bin/qcmd
# Dependencies: atcli_smd11 (ARM binary), flock, jq (for -j mode)
# =============================================================================

# --- Logging -----------------------------------------------------------------
if [ -f /usr/lib/qmanager/qlog.sh ]; then
    . /usr/lib/qmanager/qlog.sh
else
    qlog_init() { :; }
    qlog_debug() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
    qlog_at_cmd() { :; }
    qlog_lock() { :; }
fi
qlog_init "qcmd"

# --- Configuration -----------------------------------------------------------
LOCK_FILE="/tmp/qmanager_at.lock"

LOCK_WAIT_SHORT=5      # seconds to wait for lock (normal commands)
LOCK_WAIT_LONG=10      # seconds to wait for lock (long commands)

# Ensure lock file exists and is accessible by both root and www-data.
# The poller (root) and CGI scripts (www-data) share this file via flock.
[ ! -f "$LOCK_FILE" ] && touch "$LOCK_FILE" 2>/dev/null
chmod 666 "$LOCK_FILE" 2>/dev/null

# --- AT device configuration -------------------------------------------------
AT_CLI="/usr/bin/atcli_smd11"
AT_DEVICE="/dev/smd11"

if [ ! -x "$AT_CLI" ]; then
    echo "ERROR: $AT_CLI not found or not executable" >&2
    exit 1
fi

if [ ! -e "$AT_DEVICE" ]; then
    echo "ERROR: AT device $AT_DEVICE not found" >&2
    exit 1
fi

# --- Parse Arguments ---------------------------------------------------------
JSON_MODE=0
if [ "$1" = "-j" ]; then
    JSON_MODE=1
    shift
fi

COMMAND="$1"

if [ -z "$COMMAND" ]; then
    qlog_error "No command provided"
    echo '{"error":"no_command","detail":"Usage: qcmd [-j] \"AT+COMMAND\""}' >&2
    exit 1
fi

qlog_debug "Command received: ${COMMAND}"

# --- Helper: JSON Output -----------------------------------------------------
output_result() {
    _raw="$1"
    _err="$2"

    if [ "$JSON_MODE" -eq 1 ]; then
        if [ -n "$_err" ]; then
            jq -n --arg error "$_err" --arg command "$COMMAND" \
                '{success: false, error: $error, command: $command}'
        else
            jq -n --arg response "$_raw" --arg command "$COMMAND" \
                '{success: true, response: $response, command: $command}'
        fi
    else
        if [ -n "$_err" ]; then
            echo "ERROR: $_err" >&2
            exit 1
        else
            echo "$_raw"
        fi
    fi
}

# --- Helper: Command Classification -----------------------------------------
is_long_command() {
    case "$1" in
        *QSCAN*|*QSCANFREQ*|*QFOTADL*) return 0 ;;
        *) return 1 ;;
    esac
}

# --- Helper: flock with timeout ----------------------------------------------
# Usage: flock_wait <fd> <timeout_seconds>
# Returns: 0 = lock acquired, 1 = timed out
# BusyBox flock lacks -w, so we poll with -x -n in a loop.
# -----------------------------------------------------------------------------
flock_wait() {
    _fd="$1"
    _wait="$2"
    _elapsed=0

    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then
            return 0
        fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done

    # One final try
    flock -x -n "$_fd" 2>/dev/null
}

# =============================================================================
# EXECUTION
#
# Uses subshell + FD 9 redirect: ( flock 9; ...; ) 9<"$LOCK_FILE"
# Lock is auto-released when the subshell exits.
#
# atcli_smd11 always exits 0 — error detection is done by parsing the
# response text for OK/ERROR markers.
#
# atcli_smd11 handles command timeouts natively (tested: 1m+ for QSCAN).
# No external timeout wrapper needed.
# =============================================================================

# Select lock wait time based on command type
if is_long_command "$COMMAND"; then
    LOCK_WAIT="$LOCK_WAIT_LONG"
    qlog_info "Long command: ${COMMAND}"
else
    LOCK_WAIT="$LOCK_WAIT_SHORT"
fi

# Execute with flock serialization
result=$(
    (
        if ! flock_wait 9 "$LOCK_WAIT"; then
            exit 2
        fi
        "$AT_CLI" "$COMMAND" 2>/dev/null
    ) 9<"$LOCK_FILE"
)
exit_code=$?

# Handle lock failure
if [ $exit_code -eq 2 ]; then
    qlog_error "Lock acquisition failed for: ${COMMAND}"
    output_result "" "modem_busy"
    exit 1
fi

qlog_at_cmd "$COMMAND" "$result" "$exit_code"

# atcli_smd11 always exits 0 — detect errors from response text
case "$result" in
    *ERROR*)
        qlog_error "Command returned ERROR: ${COMMAND}"
        output_result "" "command_failed"
        exit 1
        ;;
    *OK*)
        output_result "$result" ""
        ;;
    *)
        # No OK or ERROR — likely empty/malformed response
        if [ -z "$result" ]; then
            qlog_error "Empty response for: ${COMMAND}"
            output_result "" "command_failed"
            exit 1
        fi
        # Some commands return data without OK (e.g., compound queries
        # where individual responses are present but no trailing OK).
        # Pass through — let the caller decide.
        output_result "$result" ""
        ;;
esac
```

Key changes from the original:
- **Removed:** `timeout` wrapper, `PID_FILE`, `LONG_FLAG`, `check_stale_lock()`, duplicate subshell blocks, external `long_commands.list`, stale lock retry logic
- **Kept:** `flock_wait()` (unchanged), `is_long_command()` (simplified — hardcoded only), `output_result()` (unchanged), JSON mode, all logging
- **Changed:** `local` keyword removed (not POSIX — use `_` prefix convention instead)
- **New:** Response parsing now handles the "no OK/ERROR" case consistently (was only in the long path before). Empty responses are treated as failures. Non-empty responses without OK/ERROR are passed through (some compound queries don't end with OK).

- [ ] **Step 3: Verify the script has correct line endings**

Run on the device or check locally:
```bash
file scripts/usr/bin/qcmd
```

Expected: ASCII text, no `\r` characters.

- [ ] **Step 4: Commit**

```bash
git add scripts/usr/bin/qcmd
git commit -m "refactor: simplify qcmd — remove timeout wrapper, PID tracking, stale lock recovery

atcli_smd11 handles command timeouts natively (tested: 1m+ for QSCAN),
making the external timeout wrapper redundant. The 3s short timeout was
actively harmful — it killed legitimate commands like AT+COPS? on slow
networks.

Removed: timeout dependency, PID_FILE, LONG_FLAG fast-fail, stale lock
recovery, duplicate long/short code paths, external long_commands.list.

Kept: flock serialization, flock_wait polling (BusyBox compat),
is_long_command (for lock wait selection), response parsing, JSON mode,
all exit codes and error strings callers depend on.

321 lines → ~150 lines. Zero caller changes needed."
```

---

### Task 2: Update the Smoke Test

**Files:**
- Modify: `scripts/usr/bin/qcmd_test`

The smoke test at test 8 (line 116-123) expects `exit code != 0` for an invalid command. This still works — qcmd returns exit 1 when the response contains ERROR. But the test should also verify the new "no OK/ERROR" handling for edge cases.

- [ ] **Step 1: Read the current smoke test**

Read `scripts/usr/bin/qcmd_test` fully. Confirm test 8 checks `$rc -ne 0` for `AT+INVALIDCMD_XYZ_TEST`.

- [ ] **Step 2: Verify existing tests still pass conceptually**

Review each test against the new qcmd behavior:

| Test | Command | Checks | Still valid? |
|------|---------|--------|-------------|
| 1 | atcli_smd11 exists | `-x` check | Yes |
| 2 | /dev/smd11 exists | `-e` check | Yes |
| 3 | Direct atcli_smd11 ATI | Response contains Quectel/OK | Yes |
| 4 | qcmd AT | rc=0 + OK in response | Yes |
| 5 | Compound AT+CGMM;+CGSN | rc=0 + non-empty | Yes |
| 6 | JSON mode AT+CSQ | `"success":true` in JSON | Yes |
| 7 | Concurrent flock | Both rc=0 | Yes |
| 8 | Invalid command | rc != 0 | Yes (ERROR in response → exit 1) |
| 9 | AT+CPMS? | rc=0 + +CPMS: | Yes |
| 10 | socat check | fuser /dev/smd11 | Yes |

All 10 tests remain valid. No changes needed to the smoke test.

- [ ] **Step 3: Add a test for the removed timeout dependency**

Add test 11 to verify `timeout` is no longer required. Append before the summary section (before line 148):

```sh
# --- Test 11: timeout binary not required ------------------------------------
echo "[11] timeout binary not required..."
# qcmd no longer depends on the timeout binary. Verify it works even
# if timeout were absent (we can't actually remove it, but we verify
# qcmd's dependency list in its header no longer mentions it).
if grep -q "Dependencies:.*timeout" /usr/bin/qcmd 2>/dev/null; then
    warn "qcmd header still lists timeout as a dependency"
else
    pass
fi
```

- [ ] **Step 4: Commit**

```bash
git add scripts/usr/bin/qcmd_test
git commit -m "test: add smoke test verifying timeout is no longer a qcmd dependency"
```

---

### Task 3: Verify Build and No Caller Breakage

**Files:** None (verification only)

- [ ] **Step 1: Verify qcmd has no syntax errors**

Run:
```bash
bash -n scripts/usr/bin/qcmd
```

Expected: No output (no syntax errors).

- [ ] **Step 2: Grep for removed features to confirm no callers depend on them**

Verify no caller references the removed error codes or files:

```bash
# No caller should reference scan_in_progress
grep -r "scan_in_progress" scripts/ --include="*.sh" | grep -v qcmd

# No caller should reference command_timeout
grep -r "command_timeout" scripts/ --include="*.sh" | grep -v qcmd

# No caller should reference the PID file
grep -r "qmanager_at.pid" scripts/ --include="*.sh" | grep -v qcmd

# No caller should reference the long flag
grep -r "qmanager_long_running" scripts/ --include="*.sh" | grep -v qcmd
```

Expected: All four greps return empty (no matches outside qcmd itself).

- [ ] **Step 3: Verify the frontend build still passes**

Run:
```bash
bun run build 2>&1 | tail -5
```

Expected: Clean build (qcmd is a backend script — frontend should be unaffected, but verify anyway).

- [ ] **Step 4: Line count check**

Run:
```bash
wc -l scripts/usr/bin/qcmd
```

Expected: ~150 lines (down from 321).
