# Independent QManager Installation — Remove SimpleAdmin Dependency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QManager fully self-contained on the RM520N-GL — install lighttpd independently, use `atcli_smd11` instead of `sms_tool`+socat, and fix the unreliable first-install service startup.

**Architecture:** QManager moves from overlaying SimpleAdmin's `/usrdata/simpleadmin/` to owning `/usrdata/qmanager/` as its root. The AT transport switches from `sms_tool` on `/dev/ttyOUT2` (smd7 via socat PTY bridge) to `atcli_smd11` on `/dev/smd11` (direct access, no socat). Service management is hardened with validation at each step.

**Tech Stack:** Shell scripts (POSIX sh), lighttpd (Entware), systemd, `atcli_smd11` (ARM binary), `jq`, `flock`

---

## Current Problems Being Solved

| Problem | Root Cause | Fix in This Plan |
|---------|-----------|-----------------|
| QManager can't install on a fresh modem (no SimpleAdmin) | Hardcoded paths to `/usrdata/simpleadmin/`, assumes www-data user, lighttpd binary, socat services all pre-exist | Own directory structure, own Entware bootstrap, create users/groups |
| Services don't start on first boot | `systemctl enable` doesn't work on RM520N-GL; symlinks created but not always validated | Explicit validation after each symlink, `systemctl daemon-reload`, startup verification |
| Socat-at-bridge is a complex 7-service dependency | sms_tool needs PTY devices; socat creates them from SMD channels | Replace with `atcli_smd11` which opens `/dev/smd11` directly — zero socat dependency |
| SMS uses sms_tool directly without qcmd lock | `sms.sh` calls `sms_tool -d /dev/ttyOUT2` without flock serialization | Route SMS through `qcmd` or use flock in sms.sh |
| lighttpd config path is entangled with SimpleAdmin | Config at `/usrdata/simpleadmin/lighttpd.conf`, web root at `/usrdata/simpleadmin/www` | Move to `/usrdata/qmanager/lighttpd.conf` and `/usrdata/qmanager/www` |

---

## atcli_smd11 — Confirmed Interface (Tested 2026-04-06)

Hardware testing on a clean-flashed RM520N-GL confirmed the following behavior:

### CLI Interface

```
Usage: atcli_smd11 "AT+COMMAND"
```

- Opens `/dev/smd11` directly via `fopen("/dev/smd11", "r+b")` — no socat or PTY bridge needed
- Device is hardcoded (no `-d` flag)
- Binary: 5.8KB ARM ELF, dynamically linked (`libc.so.6`, `libpthread.so.0`)

### Output Format

Command echo + response + terminator (OK/ERROR). Example:
```
AT+CSQ
+CSQ: 19,99

OK
```

### Exit Codes

**Always returns 0** — even when modem responds with ERROR. Error detection must be done by parsing response text for `OK` vs `ERROR`.

### Confirmed Capabilities

| Feature | Result | Notes |
|---------|--------|-------|
| Basic AT | `AT` → OK | Clean, no warnings |
| Device info | `ATI` → model, revision | Full response |
| Compound commands | `AT+CSQ;+QTEMP` → both responses + OK | Semicolon batching works |
| Serving cell | `AT+QENG="servingcell"` → full response | Quoted args work |
| **Long commands** | `AT+QSCAN=3,1` → **1m 11s**, full results + OK | **No timeout** — waits for modem to finish |
| SMS text mode | `AT+CMGF=1` → OK | SMS via AT commands works |
| SMS list | `AT+CMGL="ALL"` → OK (empty inbox) | Works |
| SMS storage | `AT+CPMS?` → `"ME",0,255` | Works |
| Error handling | `AT+INVALIDCMD` → ERROR (exit 0) | Must parse text, not exit code |

### Comparison vs sms_tool on /dev/smd11

| Aspect | atcli_smd11 | sms_tool -d /dev/smd11 |
|--------|-------------|------------------------|
| Output | Clean | `tcgetattr`/`tcsetattr` warnings on stderr (SMD != TTY) |
| Exit codes | Always 0 | Correct (0=OK, 1=ERROR) |
| Long commands | **Waits properly** (1m 11s) | **Times out** (~3s, no final OK) |
| Compound commands | Works | Works |
| SMS subcommands | N/A (AT-only) | Has `recv -j`, `status`, `send`, `delete` |
| Device compatibility | `fopen()` — correct for SMD | `tcsetattr()` — wrong for SMD |

**Decision: Use atcli_smd11, drop sms_tool entirely.** The long-command support alone is decisive — it eliminates the `_run_long_at()` workaround in qcmd. SMS operations will use AT commands (`AT+CMGL`, `AT+CMGS`, `AT+CMGD`, `AT+CPMS?`) routed through qcmd instead of sms_tool subcommands.

### Impact on qcmd Design

1. **`_run_long_at()` can be removed** — atcli_smd11 handles long commands natively (no 5s timeout)
2. **Exit code parsing must change** — check response text for `OK`/`ERROR` instead of `$?`
3. **No device override needed** — atcli_smd11 hardcodes `/dev/smd11`, simplifies configuration
4. **Locking is still required** — atcli_smd11 has no internal serialization; flock in qcmd remains essential

---

## File Structure

### New Files

```
scripts/
  usrdata/qmanager/
    lighttpd.conf                    — lighttpd config (moved from usrdata/simpleadmin/)
  etc/systemd/system/
    lighttpd.service                 — Updated: points to /usrdata/qmanager/lighttpd.conf
    qmanager-poller.service          — Updated: remove socat-smd7 dependency
    qmanager-watchcat.service        — Updated: remove socat-smd7 dependency
    qmanager-imei-check.service      — Updated: remove socat-smd7 dependency
    qmanager-tower-failover.service  — Updated: remove socat-smd7 dependency
```

### Modified Files

```
scripts/install_rm520n.sh            — Rewritten: independent install (no SimpleAdmin)
scripts/uninstall_rm520n.sh          — Updated: new paths, no SimpleAdmin restore
scripts/usr/bin/qcmd                 — Rewritten AT transport: atcli_smd11 on /dev/smd11
scripts/usr/bin/qcmd_test            — Updated: test atcli_smd11 instead of sms_tool
scripts/usr/lib/qmanager/platform.sh — Add install helpers: ensure_user, ensure_group, etc.
scripts/www/cgi-bin/quecmanager/cellular/sms.sh  — Rewrite SMS via AT commands through qcmd
scripts/usrdata/simpleadmin/lighttpd.conf → scripts/usrdata/qmanager/lighttpd.conf (move)
```

---

## Task 1: Move QManager to Independent Directory Structure

**Why:** Currently QManager writes into SimpleAdmin's `/usrdata/simpleadmin/` directory. If SimpleAdmin isn't installed, nothing works. QManager needs its own root.

**Files:**
- Move: `scripts/usrdata/simpleadmin/lighttpd.conf` → `scripts/usrdata/qmanager/lighttpd.conf`
- Modify: `scripts/etc/systemd/system/lighttpd.service`
- Modify: `scripts/install_rm520n.sh` (path constants only in this task)

### Steps

- [ ] **1.1: Move lighttpd.conf to new path**

Move the file:
```
scripts/usrdata/simpleadmin/lighttpd.conf → scripts/usrdata/qmanager/lighttpd.conf
```

Update the config contents — change document-root and add missing MIME types:

```apache
server.modules = (
    "mod_redirect",
    "mod_cgi",
    "mod_proxy",
    "mod_openssl",
)

server.username  = "www-data"
server.groupname = "dialout"
server.port      = 80

# QManager owns its own web root
server.document-root = "/usrdata/qmanager/www"
index-file.names     = ( "index.html" )

# MIME types for Next.js static export
mimetype.assign = (
    ".html" => "text/html",
    ".css"  => "text/css",
    ".js"   => "application/javascript",
    ".json" => "application/json",
    ".png"  => "image/png",
    ".jpg"  => "image/jpeg",
    ".svg"  => "image/svg+xml",
    ".ico"  => "image/x-icon",
    ".woff" => "font/woff",
    ".woff2" => "font/woff2",
    ".txt"  => "text/plain",
)

# HTTPS
$SERVER["socket"] == "0.0.0.0:443" {
    ssl.engine    = "enable"
    ssl.privkey   = "/usrdata/qmanager/certs/server.key"
    ssl.pemfile   = "/usrdata/qmanager/certs/server.crt"
    ssl.openssl.ssl-conf-cmd = ("MinProtocol" => "TLSv1.2")
}

# HTTP → HTTPS redirect
$HTTP["scheme"] == "http" {
    url.redirect = ("" => "https://${url.authority}${url.path}${qsa}")
}

# CGI handler
$HTTP["url"] =~ "/cgi-bin/" {
    cgi.assign = ( "" => "" )
}

# ttyd console proxy (optional — only if ttyd is installed)
$HTTP["url"] =~ "(^/console)" {
    proxy.header = ("map-urlpath" => ( "/console" => "/" ), "upgrade" => "enable" )
    proxy.server = ( "" => ("" => ( "host" => "127.0.0.1", "port" => 8080 )))
}
```

- [ ] **1.2: Update lighttpd.service to point to new config path**

`scripts/etc/systemd/system/lighttpd.service`:
```ini
# /lib/systemd/system/lighttpd.service
# Managed by QManager
[Unit]
Description=Lighttpd Daemon
After=network.target opt.mount

[Service]
Type=simple
PIDFile=/opt/var/run/lighttpd.pid
ExecStartPre=/opt/sbin/lighttpd -tt -f /usrdata/qmanager/lighttpd.conf
ExecStart=/opt/sbin/lighttpd -D -f /usrdata/qmanager/lighttpd.conf
ExecReload=/bin/kill -USR1 $MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

- [ ] **1.3: Update path constants in install_rm520n.sh**

Change the top-level configuration block (lines 48-72):

```bash
# Destinations
WWW_ROOT="/usrdata/qmanager/www"
CGI_DIR="/usrdata/qmanager/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
# ... (sudo detection stays the same)
CONF_DIR="/etc/qmanager"
CERT_DIR="/usrdata/qmanager/certs"
SESSION_DIR="/tmp/qmanager_sessions"
BACKUP_DIR="/etc/qmanager/backups"
LIGHTTPD_CONF="/usrdata/qmanager/lighttpd.conf"
QMANAGER_ROOT="/usrdata/qmanager"
```

- [ ] **1.4: Delete the old simpleadmin path**

Remove `scripts/usrdata/simpleadmin/` directory entirely.

- [ ] **1.5: Validate — grep for any remaining `/usrdata/simpleadmin` references**

```bash
grep -r "simpleadmin" scripts/ --include="*.sh" --include="*.conf" --include="*.service"
```

Expected: **zero matches**. Fix any remaining references.

---

## Task 2: Rewrite qcmd to Use atcli_smd11

**Why:** Currently qcmd depends on `sms_tool` + socat-at-bridge (7 systemd services). `atcli_smd11` opens `/dev/smd11` directly — zero socat dependency. Testing confirmed it handles long commands natively (AT+QSCAN waited 1m 11s), so `_run_long_at()` can be removed entirely.

**Files:**
- Modify: `scripts/usr/bin/qcmd`
- Modify: `scripts/usr/bin/qcmd_test`

### Steps

- [ ] **2.1: Rewrite qcmd header and AT device configuration**

Replace lines 1-72 (header + logging + config + device setup) in `scripts/usr/bin/qcmd`:

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
# Long commands (AT+QSCAN etc.) are handled natively — atcli_smd11 waits
# for the modem to finish (tested: 1m+ for cell scans). No workarounds needed.
#
# Usage:
#   qcmd "AT+COMMAND"          → Execute AT command, return raw result
#   qcmd -j "AT+COMMAND"       → Execute AT command, return JSON-wrapped result
#
# Install location: /usr/bin/qcmd
# Dependencies: atcli_smd11 (ARM binary), flock, timeout, jq (for -j mode)
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
LONG_FLAG="/tmp/qmanager_long_running"
PID_FILE="/tmp/qmanager_at.pid"

SHORT_TIMEOUT=3        # seconds for normal AT commands
LONG_TIMEOUT=240       # seconds for AT+QSCAN and similar (safety net only —
                       # atcli_smd11 waits natively, this prevents infinite hangs)
LOCK_WAIT_SHORT=5      # seconds to wait for lock (normal commands)
LOCK_WAIT_LONG=10      # seconds to wait for lock (long commands)

# Ensure lock/pid files exist and are accessible by both root and www-data.
[ ! -f "$LOCK_FILE" ] && touch "$LOCK_FILE" 2>/dev/null
[ ! -f "$PID_FILE" ] && touch "$PID_FILE" 2>/dev/null
chmod 666 "$LOCK_FILE" "$PID_FILE" 2>/dev/null

# --- AT device configuration (RM520N-GL: atcli_smd11 direct) -----------------
# atcli_smd11 accesses /dev/smd11 directly — no socat bridge needed.
# The device is hardcoded in the binary. We only verify it exists.
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
```

- [ ] **2.2: Remove `_run_long_at()` function entirely**

Delete lines 171-224 (the `_run_long_at` function). It is no longer needed — `atcli_smd11` waits for the modem to finish natively (confirmed: AT+QSCAN waited 1m 11s without timeout).

- [ ] **2.3: Simplify long command path**

Replace the current long command execution block (lines 233-294). The new version uses `atcli_smd11` directly with a safety `timeout` wrapper:

```sh
if is_long_command "$COMMAND"; then
    # =========================================================================
    # LONG COMMAND PATH
    # atcli_smd11 handles long commands natively (no timeout workaround needed).
    # The outer timeout is a safety net only — prevents infinite hangs.
    # =========================================================================
    qlog_info "Long command started: ${COMMAND}"
    echo "$COMMAND" > "$LONG_FLAG"

    result=$(
        (
            if ! flock_wait 9 "$LOCK_WAIT_LONG"; then
                exit 2
            fi
            echo $$ > "$PID_FILE"

            timeout "$LONG_TIMEOUT" "$AT_CLI" "$COMMAND" 2>/dev/null
            cmd_rc=$?
            rm -f "$PID_FILE"

            # timeout(1) returns 124 when it kills the child
            [ "$cmd_rc" -eq 124 ] && exit 4
            exit 0
        ) 9<"$LOCK_FILE"
    )
    exit_code=$?

    rm -f "$LONG_FLAG"

    # atcli_smd11 always exits 0 — detect errors from response text
    case $exit_code in
        0)
            case "$result" in
                *ERROR*)
                    qlog_error "Long command returned ERROR: ${COMMAND}"
                    qlog_at_cmd "$COMMAND" "$result" "1"
                    output_result "" "command_failed"
                    exit 1
                    ;;
                *OK*)
                    qlog_info "Long command completed: ${COMMAND}"
                    qlog_at_cmd "$COMMAND" "$result" "0"
                    output_result "$result" ""
                    ;;
                *)
                    # No OK or ERROR — likely empty/malformed response
                    qlog_error "Long command: no OK/ERROR in response: ${COMMAND}"
                    output_result "" "command_failed"
                    exit 1
                    ;;
            esac
            ;;
        2)
            qlog_error "Lock acquisition failed for: ${COMMAND}"
            output_result "" "modem_busy"
            exit 1
            ;;
        4)
            qlog_error "Long command timed out (${LONG_TIMEOUT}s safety limit): ${COMMAND}"
            output_result "" "command_timeout"
            exit 1
            ;;
        *)
            qlog_error "Long command failed: ${COMMAND} (exit=${exit_code})"
            output_result "" "command_failed"
            exit 1
            ;;
    esac
```

- [ ] **2.4: Rewrite short command path with response-based error detection**

Replace the current short command execution block (lines 305-358):

```sh
else
    # =========================================================================
    # SHORT COMMAND PATH
    # =========================================================================
    result=$(
        (
            if ! flock_wait 9 "$LOCK_WAIT_SHORT"; then
                exit 2
            fi
            echo $$ > "$PID_FILE"
            timeout "$SHORT_TIMEOUT" "$AT_CLI" "$COMMAND" 2>/dev/null
            cmd_rc=$?
            rm -f "$PID_FILE"
            [ "$cmd_rc" -eq 124 ] && exit 4
            exit 0
        ) 9<"$LOCK_FILE"
    )
    exit_code=$?

    # Lock failed — try stale recovery and retry once
    if [ $exit_code -eq 2 ]; then
        qlog_lock "timeout" "short command: ${COMMAND}"

        if check_stale_lock; then
            result=$(
                (
                    if ! flock_wait 9 2; then
                        exit 2
                    fi
                    echo $$ > "$PID_FILE"
                    timeout "$SHORT_TIMEOUT" "$AT_CLI" "$COMMAND" 2>/dev/null
                    cmd_rc=$?
                    rm -f "$PID_FILE"
                    [ "$cmd_rc" -eq 124 ] && exit 4
                    exit 0
                ) 9<"$LOCK_FILE"
            )
            exit_code=$?
        fi

        if [ $exit_code -eq 2 ]; then
            qlog_error "Lock acquisition failed for: ${COMMAND}"
            output_result "" "modem_busy"
            exit 1
        fi
    fi

    if [ $exit_code -eq 4 ]; then
        qlog_error "Short command timed out: ${COMMAND}"
        output_result "" "command_timeout"
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
    esac

    output_result "$result" ""
fi
```

- [ ] **2.5: Remove LONG_SAFETY_TIMEOUT constant**

Delete line 47 (`LONG_SAFETY_TIMEOUT=260`). No longer needed — `atcli_smd11` handles its own timing, we only use the `LONG_TIMEOUT` as a safety net via `timeout`.

- [ ] **2.6: Update qcmd_test**

Rewrite `scripts/usr/bin/qcmd_test` to test `atcli_smd11` instead of `sms_tool`:

Replace the sms_tool direct test (old test 3) with:
```sh
echo "--- Test: atcli_smd11 direct ---"
if [ -x /usr/bin/atcli_smd11 ]; then
    result=$(/usr/bin/atcli_smd11 "ATI" 2>&1)
    echo "atcli_smd11 ATI: $result"
    echo "Exit code: $?"
else
    echo "SKIP: atcli_smd11 not found"
fi
```

Replace device existence checks to look for `/dev/smd11` instead of `/dev/ttyOUT2`.

- [ ] **2.7: Validate — grep for remaining sms_tool/ttyOUT references in qcmd**

```bash
grep -n "sms_tool\|ttyOUT\|SMS_TOOL\|socat\|_run_long_at" scripts/usr/bin/qcmd
```

Expected: **zero matches**.

---

## Task 3: Rewrite SMS to Use qcmd Instead of Direct sms_tool

**Why:** `sms.sh` currently calls `sms_tool` directly without flock serialization, competing with qcmd for device access. SMS operations should go through qcmd using AT commands.

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/cellular/sms.sh`

### Steps

- [ ] **3.1: Remove sms_tool device configuration block from sms.sh**

Remove lines 32-41 (the `_DEFAULT_DEV`, `_sms_dev`, `SMS_TOOL_ARGS` block).

- [ ] **3.2: Replace sms_tool recv with AT command via qcmd**

Replace the `sms_tool ... recv -j` call with AT commands:

```sh
# Set text mode and list all messages via qcmd
qcmd "AT+CMGF=1" >/dev/null 2>&1
raw_list=$(qcmd "AT+CMGL=\"ALL\"")
```

Then parse the `+CMGL:` response lines into JSON. The format is:
```
+CMGL: <index>,<stat>,<oa>,<alpha>,<scts>
<message body>
```

- [ ] **3.3: Replace sms_tool send with AT commands via qcmd**

Replace the `sms_tool ... send` call:

```sh
# Set text mode
qcmd "AT+CMGF=1" >/dev/null 2>&1
# Send SMS (the message body + Ctrl-Z must be handled by atcli_smd11)
result=$(qcmd "AT+CMGS=\"$PHONE\"" 2>&1)
```

**Note:** SMS sending via `AT+CMGS` requires a two-step interaction (command → message body → Ctrl-Z). This may need a specialized helper in qcmd or direct device I/O. **This is a known complexity point** — the exact approach depends on whether `atcli_smd11` supports interactive AT commands or if we need to handle the `>` prompt manually.

If `atcli_smd11` can't handle multi-step AT+CMGS, implement a dedicated `_send_sms()` helper in qcmd that:
1. Acquires the flock
2. Opens `/dev/smd11` directly
3. Sends `AT+CMGS="<number>"\r`
4. Waits for `>` prompt
5. Sends message body + `\x1A` (Ctrl-Z)
6. Reads response

- [ ] **3.4: Replace sms_tool delete with AT command via qcmd**

```sh
# Delete single message
result=$(qcmd "AT+CMGD=$idx" 2>&1)

# Delete all messages
result=$(qcmd "AT+CMGD=1,4" 2>&1)  # 4 = delete all
```

- [ ] **3.5: Replace sms_tool status with AT command via qcmd**

```sh
# Get storage status
raw_status=$(qcmd "AT+CPMS?" 2>&1)
# Parse: +CPMS: "ME",used,total,"ME",used,total,"ME",used,total
```

- [ ] **3.6: Validate — grep for remaining sms_tool references in sms.sh**

```bash
grep -n "sms_tool\|SMS_TOOL\|ttyOUT" scripts/www/cgi-bin/quecmanager/cellular/sms.sh
```

Expected: **zero matches**.

---

## Task 4: Remove Socat Dependencies from Service Files

**Why:** With `atcli_smd11` on `/dev/smd11` (direct), the socat-at-bridge services are no longer needed. Service files that declare `After=socat-smd7-from-ttyIN2.service` will hang on boot if socat isn't installed.

**Files:**
- Modify: `scripts/etc/systemd/system/qmanager-poller.service`
- Modify: `scripts/etc/systemd/system/qmanager-watchcat.service`
- Modify: `scripts/etc/systemd/system/qmanager-imei-check.service`
- Modify: `scripts/etc/systemd/system/qmanager-tower-failover.service`

### Steps

- [ ] **4.1: Update qmanager-poller.service**

```ini
[Unit]
Description=QManager Modem Data Poller
After=qmanager-setup.service qmanager-ping.service
Wants=qmanager-ping.service

[Service]
Type=simple
ExecStartPre=/bin/sh -c '[ -e /dev/smd11 ] || { echo "AT device /dev/smd11 not found"; exit 1; }'
ExecStart=/usr/bin/qmanager_poller
EnvironmentFile=-/etc/qmanager/environment
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
```

Key changes:
- Removed `After=socat-smd7-from-ttyIN2.service`
- Added `ExecStartPre` that checks `/dev/smd11` exists (fail-fast instead of silent failure)

- [ ] **4.2: Update qmanager-watchcat.service**

Remove `After=...socat-smd7-from-ttyIN2.service`. Keep the rest unchanged:

```ini
[Unit]
Description=QManager Connection Health Watchdog
After=qmanager-poller.service
Wants=qmanager-poller.service
```

- [ ] **4.3: Update qmanager-imei-check.service**

```ini
[Unit]
Description=QManager IMEI Rejection Check (One-Shot)
After=qmanager-setup.service
```

Remove `socat-smd7-from-ttyIN2.service` from `After=`.

- [ ] **4.4: Update qmanager-tower-failover.service**

```ini
[Unit]
Description=QManager Tower Lock Failover Daemon
After=qmanager-poller.service
Wants=qmanager-poller.service
```

Remove `socat-smd7-from-ttyIN2.service` from `After=`.

- [ ] **4.5: Validate — grep for remaining socat references in service files**

```bash
grep -r "socat" scripts/etc/systemd/system/
```

Expected: **zero matches**.

---

## Task 5: Rewrite install_rm520n.sh as Independent Installer

**Why:** The current installer assumes SimpleAdmin is pre-installed. It needs to bootstrap everything from scratch: create users/groups, install Entware packages, set up lighttpd, deploy QManager, and create services — all without any prior setup.

**Files:**
- Modify: `scripts/install_rm520n.sh`

### Steps

- [ ] **5.1: Add user/group creation functions**

Add after the configuration block:

```sh
# --- System user/group helpers -----------------------------------------------
ensure_group() {
    local grp="$1"
    if ! getent group "$grp" >/dev/null 2>&1; then
        echo "[+] Creating group: $grp"
        addgroup "$grp" 2>/dev/null || groupadd "$grp" 2>/dev/null || {
            echo "[!] WARNING: Could not create group $grp"
            return 1
        }
    fi
}

ensure_user() {
    local usr="$1"
    local grp="$2"
    if ! id "$usr" >/dev/null 2>&1; then
        echo "[+] Creating user: $usr"
        adduser -S -H -D -G "$grp" "$usr" 2>/dev/null || \
        useradd -r -M -s /sbin/nologin -g "$grp" "$usr" 2>/dev/null || {
            echo "[!] WARNING: Could not create user $usr"
            return 1
        }
    fi
    # Ensure user is in dialout group (for serial device access)
    addgroup "$usr" dialout 2>/dev/null || usermod -aG dialout "$usr" 2>/dev/null || true
}
```

- [ ] **5.2: Add Entware bootstrap function**

```sh
# --- Entware bootstrap -------------------------------------------------------
ensure_entware() {
    if [ ! -x "$OPKG" ]; then
        echo "[!] Entware not found at $OPKG"
        echo "    Install Entware first: http://bin.entware.net/armv7sf-k3.2/installer/"
        echo "    Or run the RGMII toolkit to install Entware."
        return 1
    fi
    echo "[*] Entware found at $OPKG"
}

ensure_package() {
    local pkg="$1"
    local critical="$2"  # "critical" or "optional"
    
    if $OPKG list-installed 2>/dev/null | grep -q "^$pkg "; then
        echo "[*] Package already installed: $pkg"
        return 0
    fi
    
    echo "[+] Installing package: $pkg"
    $OPKG update >/dev/null 2>&1
    if $OPKG install "$pkg" 2>/dev/null; then
        echo "[*] Installed: $pkg"
        return 0
    elif [ "$critical" = "critical" ]; then
        echo "[!] FAILED to install critical package: $pkg"
        return 1
    else
        echo "[!] WARNING: Could not install optional package: $pkg"
        return 0
    fi
}
```

- [ ] **5.3: Add lighttpd setup function**

```sh
# --- lighttpd setup -----------------------------------------------------------
setup_lighttpd() {
    echo ""
    echo "=== Setting up lighttpd web server ==="
    
    # Install lighttpd and required modules
    ensure_package "lighttpd" "critical" || return 1
    ensure_package "lighttpd-mod-openssl" "critical" || return 1
    
    # Create QManager directory structure
    mkdir -p "$QMANAGER_ROOT/www"
    mkdir -p "$QMANAGER_ROOT/www/cgi-bin/quecmanager"
    mkdir -p "$QMANAGER_ROOT/certs"
    
    # Deploy lighttpd config
    cp "$SRC_SCRIPTS/usrdata/qmanager/lighttpd.conf" "$LIGHTTPD_CONF"
    
    # Generate TLS certificate if missing
    if [ ! -f "$CERT_DIR/server.key" ] || [ ! -f "$CERT_DIR/server.crt" ]; then
        echo "[+] Generating self-signed TLS certificate..."
        openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
            -subj "/C=US/ST=NA/L=NA/O=QManager/CN=localhost" \
            -keyout "$CERT_DIR/server.key" \
            -out "$CERT_DIR/server.crt" 2>/dev/null
        chmod 600 "$CERT_DIR/server.key"
    fi
    
    echo "[*] lighttpd setup complete"
}
```

- [ ] **5.4: Add service installation with validation**

Replace the service installation section with a robust version that validates each step:

```sh
# --- Service installation with validation ------------------------------------
install_service() {
    local name="$1"
    local src="$SRC_SCRIPTS/etc/systemd/system/${name}.service"
    local dst="$SYSTEMD_DIR/${name}.service"
    local want="$WANTS_DIR/${name}.service"
    
    if [ ! -f "$src" ]; then
        echo "[!] Service file not found: $src"
        return 1
    fi
    
    cp "$src" "$dst"
    
    # Validate the service file was copied
    if [ ! -f "$dst" ]; then
        echo "[!] FAILED: $dst was not created"
        return 1
    fi
    
    echo "[*] Installed service: $name"
}

enable_service() {
    local name="$1"
    local dst="$SYSTEMD_DIR/${name}.service"
    local want="$WANTS_DIR/${name}.service"
    
    # Create boot symlink (systemctl enable doesn't work on RM520N-GL)
    ln -sf "$dst" "$want"
    
    # Validate the symlink was created
    if [ ! -L "$want" ]; then
        echo "[!] FAILED: boot symlink not created for $name"
        echo "    Expected: $want → $dst"
        return 1
    fi
    
    echo "[*] Enabled for boot: $name"
}

start_service() {
    local name="$1"
    
    systemctl start "$name" 2>/dev/null
    sleep 1
    
    if systemctl is-active "$name" >/dev/null 2>&1; then
        echo "[*] Started: $name"
    else
        echo "[!] WARNING: $name did not start. Check: journalctl -u $name"
    fi
}
```

- [ ] **5.5: Add the `atcli_smd11` installation step**

Add to the binary installation section:

```sh
# Install atcli_smd11 (AT command transport — replaces sms_tool + socat)
if [ -f "$SRC_DEPS/atcli_smd11" ]; then
    cp "$SRC_DEPS/atcli_smd11" "$BIN_DIR/atcli_smd11"
    chmod 755 "$BIN_DIR/atcli_smd11"
    echo "[*] Installed: atcli_smd11"
else
    echo "[!] CRITICAL: atcli_smd11 not found in dependencies/"
    exit 1
fi
```

- [ ] **5.6: Add socat-smd11 conflict check**

Before starting services, check if socat-smd11 is running and stop it:

```sh
# --- Ensure /dev/smd11 is not locked by socat-at-bridge ----------------------
echo ""
echo "=== Checking AT device access ==="
for svc in socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN; do
    if systemctl is-active "$svc" >/dev/null 2>&1; then
        echo "[+] Stopping conflicting service: $svc"
        systemctl stop "$svc" 2>/dev/null
        # Remove boot symlink so it doesn't restart
        rm -f "$WANTS_DIR/${svc}.service"
    fi
done

# Verify /dev/smd11 is accessible
if [ -e /dev/smd11 ]; then
    echo "[*] AT device /dev/smd11 is available"
else
    echo "[!] WARNING: /dev/smd11 not found — AT commands will not work"
fi
```

- [ ] **5.7: Restructure the main install flow**

Rewrite the main execution body to follow this order:

```sh
main() {
    echo "=== QManager $VERSION — RM520N-GL Independent Installer ==="
    echo ""
    
    # Phase 1: Prerequisites
    echo "=== Phase 1: Prerequisites ==="
    mount -o remount,rw / 2>/dev/null
    ensure_entware || { echo "FATAL: Entware required"; exit 1; }
    ensure_group "dialout"
    ensure_group "www-data"
    ensure_user "www-data" "www-data"
    
    # Phase 2: Packages
    echo ""
    echo "=== Phase 2: Package Dependencies ==="
    ensure_package "sudo" "critical"
    install_jq  # existing function: tries opkg, falls back to bundled .ipk
    ensure_package "coreutils-timeout" "optional"
    
    # Phase 3: lighttpd
    setup_lighttpd
    
    # Phase 4: Stop existing services (if upgrading)
    stop_existing_services
    
    # Phase 5: Deploy files
    echo ""
    echo "=== Phase 5: Deploy QManager ==="
    install_frontend
    install_cgi_scripts
    install_libraries
    install_daemons
    install_config
    install_sudoers
    
    # Phase 6: AT device setup
    ensure_at_device
    
    # Phase 7: Systemd services
    echo ""
    echo "=== Phase 7: Systemd Services ==="
    systemctl daemon-reload
    
    install_service "lighttpd"
    install_service "qmanager-setup"
    install_service "qmanager-ping"
    install_service "qmanager-poller"
    install_service "qmanager-ttl"
    install_service "qmanager-mtu"
    install_service "qmanager-watchcat"
    install_service "qmanager-tower-failover"
    install_service "qmanager-imei-check"
    
    enable_service "lighttpd"
    enable_service "qmanager-setup"
    enable_service "qmanager-ping"
    enable_service "qmanager-poller"
    
    systemctl daemon-reload
    
    # Phase 8: Permissions & temp files
    setup_permissions
    
    # Phase 9: Start services
    echo ""
    echo "=== Phase 9: Start Services ==="
    start_service "qmanager-setup"
    start_service "qmanager-ping"
    start_service "qmanager-poller"
    start_service "lighttpd"
    
    # Phase 10: Verify
    echo ""
    echo "=== Phase 10: Verification ==="
    verify_installation
    
    echo ""
    echo "=== QManager $VERSION installed successfully ==="
    echo "    Access: https://192.168.225.1"
    
    sync  # Flush rootfs writes to NAND
}
```

- [ ] **5.8: Add verification function**

```sh
verify_installation() {
    local errors=0
    
    # Check critical files
    for f in /usr/bin/qcmd /usr/bin/atcli_smd11 /usr/bin/qmanager_poller "$LIGHTTPD_CONF"; do
        if [ -f "$f" ]; then
            echo "[*] Found: $f"
        else
            echo "[!] MISSING: $f"
            errors=$((errors + 1))
        fi
    done
    
    # Check critical services
    for svc in lighttpd qmanager-setup qmanager-ping qmanager-poller; do
        if systemctl is-active "$svc" >/dev/null 2>&1; then
            echo "[*] Running: $svc"
        else
            echo "[!] NOT RUNNING: $svc (check: journalctl -u $svc)"
            errors=$((errors + 1))
        fi
    done
    
    # Check AT device
    if [ -e /dev/smd11 ]; then
        echo "[*] AT device: /dev/smd11 exists"
        if timeout 3 /usr/bin/atcli_smd11 "AT" >/dev/null 2>&1; then
            echo "[*] AT device: responds to AT command"
        else
            echo "[!] AT device: no response (modem may not be ready)"
            errors=$((errors + 1))
        fi
    else
        echo "[!] AT device: /dev/smd11 not found"
        errors=$((errors + 1))
    fi
    
    # Check web server
    if systemctl is-active lighttpd >/dev/null 2>&1; then
        echo "[*] Web server: lighttpd is running"
    fi
    
    if [ $errors -gt 0 ]; then
        echo ""
        echo "[!] Installation completed with $errors warning(s)"
        echo "    Some features may not work until issues are resolved."
    fi
}
```

- [ ] **5.9: Validate — run shellcheck on the installer**

```bash
shellcheck scripts/install_rm520n.sh
```

Fix any issues.

---

## Task 6: Update uninstall_rm520n.sh

**Why:** The uninstaller currently restores SimpleAdmin backups. Since QManager is now independent, it should clean up its own directory without referencing SimpleAdmin.

**Files:**
- Modify: `scripts/uninstall_rm520n.sh`

### Steps

- [ ] **6.1: Update uninstaller paths**

Replace all `/usrdata/simpleadmin/` references with `/usrdata/qmanager/`:

```sh
# Remove QManager web root (but NOT /usrdata/qmanager/certs — keep TLS certs)
rm -rf /usrdata/qmanager/www
rm -f /usrdata/qmanager/lighttpd.conf
```

- [ ] **6.2: Remove SimpleAdmin restore logic**

Remove all lines that:
- Restore `index.html.bak`
- Restore `lighttpd.conf.simpleadmin.bak`
- Reference SimpleAdmin original files

The uninstaller should NOT restore SimpleAdmin since QManager is no longer an overlay.

- [ ] **6.3: Add atcli_smd11 removal**

```sh
rm -f /usr/bin/atcli_smd11
```

- [ ] **6.4: Remove sms_tool reference**

Replace `rm -f /usr/bin/sms_tool` — sms_tool is no longer installed by QManager.

- [ ] **6.5: Validate — grep for simpleadmin references**

```bash
grep -n "simpleadmin" scripts/uninstall_rm520n.sh
```

Expected: **zero matches**.

---

## Task 7: Update platform.sh and Documentation

**Files:**
- Modify: `scripts/usr/lib/qmanager/platform.sh`
- Modify: `docs/rm520n-gl-architecture.md` (update AT transport and install sections)
- Modify: `CLAUDE.md` (update RM520N-GL section)

### Steps

- [ ] **7.1: Add install helper functions to platform.sh**

(If the ensure_group/ensure_user functions from Task 5 are useful at runtime, add them to platform.sh. Otherwise, keep them in the install script only.)

- [ ] **7.2: Update architecture doc — AT transport section**

Update `docs/rm520n-gl-architecture.md`:
- Quick Reference table: change AT tools from `sms_tool via qcmd` to `atcli_smd11 via qcmd`
- AT bridge device from `/dev/ttyOUT2 (smd7)` to `/dev/smd11 (direct)`
- Update the PTY Bridge Architecture section to note that socat is no longer used by QManager
- Update the Data Flow Diagram for the new direct path
- Update the Systemd Service Dependency Graph (remove socat chain from QManager services)
- Update the complete boot sequence

- [ ] **7.3: Update CLAUDE.md — RM520N-GL section**

Update the AT Command Transport section:
```markdown
### AT Command Transport

- **RM551E**: `sms_tool` via USB, wrapped by `qcmd`
- **RM520N-GL**: `atcli_smd11` on `/dev/smd11` (direct access, no socat), wrapped by `qcmd`
- `atcli_smd11` opens `/dev/smd11` directly — no socat-at-bridge or PTY bridge needed
- `qcmd` uses `flock` with read-only FD (`9<`) for serialization
```

Update the SimpleAdmin Foundation section to note QManager is now independent:
```markdown
### QManager Independence

QManager no longer depends on SimpleAdmin. It installs its own:
- lighttpd from Entware with config at `/usrdata/qmanager/lighttpd.conf`
- Web root at `/usrdata/qmanager/www/`
- `www-data` user/group creation (if missing)
- TLS certificate generation
- AT command transport via `atcli_smd11` (no socat-at-bridge)
```

- [ ] **7.4: Validate — full grep for stale references**

```bash
# No remaining ttyOUT references in scripts (except maybe comments/docs)
grep -rn "ttyOUT\|sms_tool" scripts/ --include="*.sh" --include="*.service" --include="*.conf" | grep -v "^Binary" | grep -v "#"

# No remaining simpleadmin path references in scripts
grep -rn "/usrdata/simpleadmin" scripts/ --include="*.sh" --include="*.service" --include="*.conf"
```

Expected: **zero matches** for both (excluding comments and docs).

---

## Execution Order

```
Task 1: Directory structure (no runtime changes, safe)
   ↓
Task 2: qcmd rewrite (atcli_smd11 interface confirmed via hardware testing)
   ↓
Task 3: SMS rewrite (depends on qcmd changes from Task 2)
   ↓
Task 4: Service files (remove socat deps)
   ↓
Task 5: Installer rewrite (brings everything together)
   ↓
Task 6: Uninstaller update
   ↓
Task 7: Documentation
```

No gates — `atcli_smd11` hardware testing is complete (2026-04-06). All tasks can proceed sequentially.

---

## What This Plan Does NOT Change

- **Auth system:** The cookie-based session auth (`cgi_auth.sh`) is fully independent of SimpleAdmin and works correctly. No changes needed.
- **Config system:** `/etc/qmanager/qmanager.conf` and the JSON config library are independent. No changes needed.
- **Frontend:** The Next.js static export is platform-agnostic. Only the deployment path changes (`/usrdata/qmanager/www/` instead of `/usrdata/simpleadmin/www/`).
- **Daemon logic:** The poller, ping, watchcat, tower-failover, and IMEI check daemons all use `qcmd` — they don't need changes. Only the service files (removing socat dep) change.
- **socat-at-bridge itself:** We don't uninstall or modify it. It can continue running for smd7 if other tools (SimpleAdmin's console, atcmd CLI) need it. QManager's installer stops and disables smd11's socat services since `atcli_smd11` needs smd11 unlocked.
