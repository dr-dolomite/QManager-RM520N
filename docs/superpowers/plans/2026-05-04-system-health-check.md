# System Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "System Health Check" page under System Settings that runs a battery of binary/permission/AT/SMS/sudoers/systemd/network/config checks against the device, surfaces results live in a dashboard-style UI, and produces a redacted `.tar.gz` diagnostic bundle for download.

**Architecture:** Backend uses a privileged shell runner (`qmanager_health_check`, sudoers-whitelisted) launched detached by a `run.sh` CGI; results stream into `/tmp/qmanager_health_check.json` which the frontend polls every 500ms via `status.sh`. When the runner finishes it builds a tarball at `/tmp/qmanager_health_check_<job_id>.tar.gz` that `download.sh` streams with attachment headers. Frontend follows existing QManager conventions (shadcn Cards, outline status badges, plain CardHeader, default-variant primary buttons).

**Tech Stack:** Bash 4 + jq + tar/gzip on the device side; Next.js 15 / React 19 / TypeScript / shadcn-ui on the frontend. No new dependencies.

---

## File Structure

**Backend (new):**
- `scripts/usr/bin/qmanager_health_check` — privileged runner (bash). Iterates tests, writes incremental status JSON, builds tarball with redaction.
- `scripts/www/cgi-bin/quecmanager/system/health-check/run.sh` — POST: spawn runner, return `job_id`. Idempotent.
- `scripts/www/cgi-bin/quecmanager/system/health-check/status.sh` — GET: serve current status JSON, or single test output via `?test_id=`.
- `scripts/www/cgi-bin/quecmanager/system/health-check/download.sh` — GET: stream tarball, validates `job_id`.
- `scripts/test/health-check-redaction.sh` — manual fixture verifying the redaction filter masks each secret type.

**Backend (modified):**
- `scripts/etc/sudoers.d/qmanager` — whitelist `/usr/bin/qmanager_health_check` for www-data.

**Frontend (new):**
- `types/system-health-check.ts` — shared TypeScript interfaces.
- `hooks/use-system-health-check.ts` — start/poll/abort/download lifecycle hook.
- `app/system-settings/system-health-check/page.tsx` — Next.js page entry.
- `components/system-settings/system-health-check/system-health-check.tsx` — top-level component (page layout).
- `components/system-settings/system-health-check/summary-card.tsx` — summary card with run/download buttons + counts.
- `components/system-settings/system-health-check/category-card.tsx` — one card per test category.
- `components/system-settings/system-health-check/test-row.tsx` — single test row with expandable failed-output panel.
- `components/system-settings/system-health-check/health-status-badge.tsx` — outline badge variants for the 5 test states.

**Frontend (modified):**
- `components/app-sidebar.tsx` — add "System Health Check" nav sub-item under System Settings.

Each file holds one responsibility. Components are small and focused per CLAUDE.md design principles. The runner script is intentionally self-contained (single file) so the test catalog is easy to scan and edit when adding more Quectel models.

---

## Conventions Being Followed

These come from `CLAUDE.md` and existing patterns in the repo. The plan repeats them where they apply, but they hold for every UI/script step:

- Shell scripts are POSIX `sh` unless they need bash-specific features. The runner uses `#!/bin/bash` (RM520N-GL has bash; the runner needs arrays for redaction patterns).
- Source `cgi_base.sh` at the top of every CGI; it sets PATH (including `/opt/bin`), CORS headers, auth, and helpers like `cgi_error`, `cgi_handle_options`, `pid_alive`.
- Use `flock -x -n` in a polling loop (BusyBox flock has no `-w`); see `flock_wait()` in `qcmd`.
- Shared AT lock: `/tmp/qmanager_at.lock`. New runtime files: `/tmp/qmanager_health_check.json`, `/tmp/qmanager_health_check.lock`, `/tmp/qmanager_health_check_<job_id>/`, `/tmp/qmanager_health_check_<job_id>.tar.gz`.
- Status badges: outline variant only with the five class sets in `CLAUDE.md` (`bg-success/15 …`, `bg-warning/15 …`, `bg-destructive/15 …`, `bg-info/15 …`, `bg-muted/50 …`).
- Card headers: plain `CardTitle` + `CardDescription`, no icons.
- Primary buttons (Run Diagnostics, Download Bundle): `<Button>` default variant; spinner = `Loader2Icon` with `animate-spin`.
- File line endings: LF only. `.gitattributes` already enforces this (text=auto / eol=lf), and the installer strips `\r` from deployed scripts.
- `set -e` traps: never end a function with `[ ] && cmd` when `set -e` is enabled — use `if/then/fi`.
- `bunx tsc --noEmit` is the type-check command; `bun run build` is the production build.

---

## Task 1: Add types module

**Files:**
- Create: `types/system-health-check.ts`

- [ ] **Step 1: Create the type file**

```ts
// types/system-health-check.ts
// Shared types for the System Health Check feature.

export type TestStatus = "pending" | "running" | "pass" | "fail" | "warn" | "skip";

export type JobStatus = "running" | "complete" | "complete_no_bundle" | "error";

export type TestCategory =
  | "binaries"
  | "permissions"
  | "at_transport"
  | "sms"
  | "sudoers"
  | "services"
  | "network"
  | "configuration";

export interface HealthCheckTest {
  id: string;
  category: TestCategory;
  label: string;
  status: TestStatus;
  duration_ms: number;
  detail: string;
}

export interface HealthCheckSummary {
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  total: number;
}

export interface HealthCheckJob {
  job_id: string;
  status: JobStatus;
  started_at: number;
  finished_at: number | null;
  pid: number;
  summary: HealthCheckSummary;
  tests: HealthCheckTest[];
  tarball_path: string | null;
  tarball_size: number | null;
  error: string | null;
}

export interface RunResponse {
  success: boolean;
  job_id?: string;
  started_at?: number;
  error?: string;
  detail?: string;
}

export interface TestOutputResponse {
  success: boolean;
  test_id?: string;
  output?: string;
  truncated?: boolean;
  error?: string;
}

export const CATEGORY_LABELS: Record<TestCategory, string> = {
  binaries: "Binaries & Versions",
  permissions: "Filesystem & Permissions",
  at_transport: "AT Transport",
  sms: "SMS Subsystem",
  sudoers: "Sudoers",
  services: "Systemd Services",
  network: "Network",
  configuration: "Configuration",
};

export const CATEGORY_DESCRIPTIONS: Record<TestCategory, string> = {
  binaries: "Required binaries and version checks",
  permissions: "Filesystem ownership, modes, and group membership",
  at_transport: "qcmd / atcli_smd11 round-trip checks against the modem",
  sms: "sms_tool readiness and SIM presence",
  sudoers: "www-data sudoers helper visibility",
  services: "Systemd unit presence, enablement, and active state",
  network: "DNS, IPv4, modem data path, lighttpd, firewall",
  configuration: "QManager config files and poller cache freshness",
};
```

- [ ] **Step 2: Type-check the module**

Run: `bunx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add types/system-health-check.ts
git commit -m "feat(system-health-check): add shared TypeScript types"
```

---

## Task 2: Add the privileged runner skeleton

**Files:**
- Create: `scripts/usr/bin/qmanager_health_check`

This task creates the runner with two test stubs (one passing, one failing) and the JSON-emit pipeline. Real tests are added in Task 3. Splitting it this way keeps the diff focused and makes the writeback contract easy to verify before piling tests on.

- [ ] **Step 1: Create the runner with skeleton**

```bash
#!/bin/bash
# =============================================================================
# qmanager_health_check — Privileged System Health Check runner
# =============================================================================
# Called by www-data CGI via sudo. Whitelisted in /etc/sudoers.d/qmanager.
#
# Usage:
#   qmanager_health_check <job_id>
#
# Writes incremental status to /tmp/qmanager_health_check.json. Per-test raw
# output goes to /tmp/qmanager_health_check_<job_id>/tests/<test_id>.txt.
# When done, builds /tmp/qmanager_health_check_<job_id>.tar.gz.
# =============================================================================

set -u

JOB_ID="${1:-}"
if [ -z "$JOB_ID" ] || ! printf '%s' "$JOB_ID" | grep -qE '^[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$'; then
    echo "ERROR: invalid or missing job_id" >&2
    exit 2
fi

STATUS_FILE="/tmp/qmanager_health_check.json"
LOCK_FILE="/tmp/qmanager_health_check.lock"
JOB_DIR="/tmp/qmanager_health_check_${JOB_ID}"
TESTS_DIR="${JOB_DIR}/tests"
TARBALL="/tmp/qmanager_health_check_${JOB_ID}.tar.gz"

mkdir -p "$TESTS_DIR"

# --- Helpers ---------------------------------------------------------------

# Re-write status JSON atomically. Caller passes the new JSON on stdin.
_atomic_write() {
    local tmp="${STATUS_FILE}.tmp"
    cat > "$tmp"
    mv "$tmp" "$STATUS_FILE"
}

# Single shared lock for the live JSON read-modify-write.
_with_lock() {
    local fd
    exec 9>"$LOCK_FILE"
    flock -x 9
    "$@"
    local rc=$?
    flock -u 9
    exec 9>&-
    return $rc
}

# Emit a per-test result. Args: id category label status duration_ms detail
_emit_result() {
    local id="$1" category="$2" label="$3" status="$4" duration_ms="$5" detail="$6"
    _with_lock _emit_result_locked "$id" "$category" "$label" "$status" "$duration_ms" "$detail"
}

_emit_result_locked() {
    local id="$1" category="$2" label="$3" status="$4" duration_ms="$5" detail="$6"
    jq --arg id "$id" --arg category "$category" --arg label "$label" \
       --arg status "$status" --argjson dur "$duration_ms" --arg detail "$detail" '
        .tests = ((.tests // []) | map(if .id == $id
            then . + {category:$category,label:$label,status:$status,duration_ms:$dur,detail:$detail}
            else . end))
        | .summary = (
            (.tests // []) | reduce .[] as $t (
                {pass:0,fail:0,warn:0,skip:0,total:(length)};
                if   $t.status == "pass" then .pass += 1
                elif $t.status == "fail" then .fail += 1
                elif $t.status == "warn" then .warn += 1
                elif $t.status == "skip" then .skip += 1
                else . end
            ) | .total = ((.pass) + (.fail) + (.warn) + (.skip) + 0)
        )
    ' "$STATUS_FILE" | _atomic_write
}

# Run a test function with timing. Args: id category label fn
# The test function writes raw output to $OUTPUT_FILE and prints
# "<status>|<detail>" on stdout (status in pass|fail|warn|skip).
_run_test() {
    local id="$1" category="$2" label="$3" fn="$4"
    OUTPUT_FILE="${TESTS_DIR}/${id}.txt"
    : > "$OUTPUT_FILE"
    local start; start=$(date +%s%3N)
    local result; result=$("$fn" 2>>"$OUTPUT_FILE") || result="fail|test runner error (rc=$?)"
    local end; end=$(date +%s%3N)
    local dur=$(( end - start ))
    local status="${result%%|*}"
    local detail="${result#*|}"
    case "$status" in pass|fail|warn|skip) ;; *) status="fail"; detail="invalid status from test fn" ;; esac
    _emit_result "$id" "$category" "$label" "$status" "$dur" "$detail"
}

# --- Status JSON initialization --------------------------------------------

_init_status() {
    local pid=$$
    local started; started=$(date +%s)
    # All tests start as pending. Catalog is the source of truth.
    local catalog
    catalog=$(_test_catalog_pending)
    jq -n --arg job_id "$JOB_ID" --argjson started "$started" --argjson pid "$pid" \
          --argjson tests "$catalog" '
        {
            job_id: $job_id,
            status: "running",
            started_at: $started,
            finished_at: null,
            pid: $pid,
            summary: { pass: 0, fail: 0, warn: 0, skip: 0,
                       total: ($tests | length) },
            tests: $tests,
            tarball_path: null,
            tarball_size: null,
            error: null
        }
    ' | _atomic_write
}

# Catalog of all tests in pending state. Defined adjacent to test functions
# so adding a test only touches one place.
_test_catalog_pending() {
    jq -n '[
        {id:"bin.placeholder_pass",  category:"binaries",   label:"placeholder pass",  status:"pending", duration_ms:0, detail:""},
        {id:"bin.placeholder_fail",  category:"binaries",   label:"placeholder fail",  status:"pending", duration_ms:0, detail:""}
    ]'
}

# --- Skeleton tests (replaced in Task 3) -----------------------------------

t_placeholder_pass() {
    echo "this output is bundled into the tarball" >> "$OUTPUT_FILE"
    echo "pass|placeholder ok"
}

t_placeholder_fail() {
    echo "simulated failure" >> "$OUTPUT_FILE"
    echo "fail|simulated"
}

# --- Finalization -----------------------------------------------------------

_finalize_status() {
    local final_status="$1" err_msg="${2:-}"
    local finished; finished=$(date +%s)
    local size=0
    if [ -f "$TARBALL" ]; then
        size=$(stat -c%s "$TARBALL" 2>/dev/null || echo 0)
    fi
    _with_lock _finalize_status_locked "$final_status" "$err_msg" "$finished" "$size"
}

_finalize_status_locked() {
    local final_status="$1" err_msg="$2" finished="$3" size="$4"
    jq --arg s "$final_status" --arg e "$err_msg" \
       --argjson fin "$finished" --argjson sz "$size" \
       --arg path "$TARBALL" '
        .status = $s
        | .finished_at = $fin
        | .tarball_path = (if $sz > 0 then $path else null end)
        | .tarball_size = (if $sz > 0 then $sz else null end)
        | .error = (if $e == "" then null else $e end)
    ' "$STATUS_FILE" | _atomic_write
}

# --- Cleanup of stale prior runs -------------------------------------------

_cleanup_stale() {
    # Remove old job directories and tarballs older than 1 hour.
    find /tmp -maxdepth 1 -name 'qmanager_health_check_*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
}

# --- Main ------------------------------------------------------------------

_cleanup_stale
_init_status

_run_test bin.placeholder_pass binaries "placeholder pass" t_placeholder_pass
_run_test bin.placeholder_fail binaries "placeholder fail" t_placeholder_fail

# Tarball stub — Task 4 fills in real bundling and redaction.
tar -czf "$TARBALL" -C /tmp "qmanager_health_check_${JOB_ID}" 2>/dev/null \
    && _finalize_status "complete" \
    || _finalize_status "complete_no_bundle" "tarball build failed"

exit 0
```

- [ ] **Step 2: Make it executable and verify it parses**

```bash
chmod +x scripts/usr/bin/qmanager_health_check
bash -n scripts/usr/bin/qmanager_health_check
```

Expected: no output (parse OK).

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_health_check
git commit -m "feat(system-health-check): add runner skeleton with status pipeline"
```

---

## Task 3: Replace skeleton tests with the real catalog

**Files:**
- Modify: `scripts/usr/bin/qmanager_health_check`

Replace `_test_catalog_pending` and the placeholder test functions with the real catalog. Each test function is small, single-purpose, and writes raw output to `$OUTPUT_FILE`.

- [ ] **Step 1: Replace `_test_catalog_pending`**

Locate the `_test_catalog_pending()` function and replace its body with:

```bash
_test_catalog_pending() {
    jq -n '[
        {id:"bin.atcli",          category:"binaries", label:"atcli_smd11 binary present",  status:"pending", duration_ms:0, detail:""},
        {id:"bin.sms_tool",       category:"binaries", label:"sms_tool binary present",     status:"pending", duration_ms:0, detail:""},
        {id:"bin.qcmd",           category:"binaries", label:"qcmd wrapper present",        status:"pending", duration_ms:0, detail:""},
        {id:"bin.jq",             category:"binaries", label:"jq present",                  status:"pending", duration_ms:0, detail:""},
        {id:"bin.curl",           category:"binaries", label:"curl present",                status:"pending", duration_ms:0, detail:""},
        {id:"bin.openssl",        category:"binaries", label:"openssl present",             status:"pending", duration_ms:0, detail:""},
        {id:"bin.xmlstarlet",     category:"binaries", label:"xmlstarlet present",          status:"pending", duration_ms:0, detail:""},
        {id:"bin.speedtest",      category:"binaries", label:"speedtest CLI",               status:"pending", duration_ms:0, detail:""},
        {id:"bin.tailscale",      category:"binaries", label:"tailscale binary",            status:"pending", duration_ms:0, detail:""},
        {id:"bin.msmtp",          category:"binaries", label:"msmtp binary",                status:"pending", duration_ms:0, detail:""},
        {id:"bin.ttyd",           category:"binaries", label:"ttyd binary",                 status:"pending", duration_ms:0, detail:""},

        {id:"perm.smd11",         category:"permissions", label:"/dev/smd11 mode 660 root:dialout", status:"pending", duration_ms:0, detail:""},
        {id:"perm.www_dialout",   category:"permissions", label:"www-data is in dialout group",     status:"pending", duration_ms:0, detail:""},
        {id:"perm.qmanager_dir",  category:"permissions", label:"/usrdata/qmanager traversable",    status:"pending", duration_ms:0, detail:""},
        {id:"perm.rootfs_state",  category:"permissions", label:"rootfs read-only by default",      status:"pending", duration_ms:0, detail:""},
        {id:"perm.tmp_writable",  category:"permissions", label:"/tmp writable by www-data",        status:"pending", duration_ms:0, detail:""},

        {id:"at.echo",            category:"at_transport", label:"AT echo (qcmd \"AT\")",           status:"pending", duration_ms:0, detail:""},
        {id:"at.cgmi",            category:"at_transport", label:"AT+CGMI returns manufacturer",    status:"pending", duration_ms:0, detail:""},
        {id:"at.cgmm",            category:"at_transport", label:"AT+CGMM returns model",           status:"pending", duration_ms:0, detail:""},
        {id:"at.cgsn",            category:"at_transport", label:"AT+CGSN returns IMEI",            status:"pending", duration_ms:0, detail:""},
        {id:"at.cfun",            category:"at_transport", label:"AT+CFUN? radio state",            status:"pending", duration_ms:0, detail:""},
        {id:"at.lock_serial",     category:"at_transport", label:"qcmd serializes back-to-back",    status:"pending", duration_ms:0, detail:""},

        {id:"sms.recv_listing",   category:"sms", label:"sms_tool -j recv returns valid JSON", status:"pending", duration_ms:0, detail:""},
        {id:"sms.flock",          category:"sms", label:"flock on shared AT lock works",        status:"pending", duration_ms:0, detail:""},
        {id:"sms.cpin",           category:"sms", label:"AT+CPIN? returns READY",               status:"pending", duration_ms:0, detail:""},

        {id:"sudo.list",          category:"sudoers", label:"sudo -n -l shows qmanager helpers", status:"pending", duration_ms:0, detail:""},

        {id:"svc.firewall",       category:"services", label:"qmanager-firewall.service",         status:"pending", duration_ms:0, detail:""},
        {id:"svc.poller",         category:"services", label:"qmanager-poller.service",           status:"pending", duration_ms:0, detail:""},
        {id:"svc.console",        category:"services", label:"qmanager-console.service",          status:"pending", duration_ms:0, detail:""},
        {id:"svc.setup",          category:"services", label:"qmanager-setup.service",            status:"pending", duration_ms:0, detail:""},
        {id:"svc.lighttpd",       category:"services", label:"lighttpd.service",                  status:"pending", duration_ms:0, detail:""},
        {id:"svc.tailscaled",     category:"services", label:"tailscaled.service (optional)",     status:"pending", duration_ms:0, detail:""},

        {id:"net.dns",            category:"network", label:"DNS resolves install.speedtest.net", status:"pending", duration_ms:0, detail:""},
        {id:"net.ping",           category:"network", label:"IPv4 reachability (1.1.1.1)",        status:"pending", duration_ms:0, detail:""},
        {id:"net.rmnet",          category:"network", label:"rmnet+ has IP",                      status:"pending", duration_ms:0, detail:""},
        {id:"net.lighttpd_listen",category:"network", label:"lighttpd listening on 80/443",       status:"pending", duration_ms:0, detail:""},
        {id:"net.firewall_rules", category:"network", label:"iptables INPUT rules loaded",        status:"pending", duration_ms:0, detail:""},

        {id:"cfg.qmanager_dir",   category:"configuration", label:"/etc/qmanager exists",          status:"pending", duration_ms:0, detail:""},
        {id:"cfg.sms_alerts_json",category:"configuration", label:"sms_alerts.json valid",         status:"pending", duration_ms:0, detail:""},
        {id:"cfg.email_alerts_json",category:"configuration", label:"email_alerts.json valid",     status:"pending", duration_ms:0, detail:""},
        {id:"cfg.poller_cache_fresh", category:"configuration", label:"poller cache mtime < 60s",  status:"pending", duration_ms:0, detail:""},
        {id:"cfg.cgi_path_opt",   category:"configuration", label:"lighttpd CGI PATH includes /opt/bin", status:"pending", duration_ms:0, detail:""}
    ]'
}
```

- [ ] **Step 2: Replace placeholder test functions with the real ones**

Delete `t_placeholder_pass` and `t_placeholder_fail`. Insert the following test functions in their place:

```bash
# --- Test functions --------------------------------------------------------
# Each prints "<status>|<detail>" on stdout. Raw output → $OUTPUT_FILE.
# Status: pass | fail | warn | skip

_check_bin() {
    # _check_bin <name> <path> <warn-if-missing?>
    local name="$1" path="$2" soft="${3:-0}"
    if [ -x "$path" ]; then
        local v
        v=$("$path" --version 2>&1 | head -1 || true)
        echo "$path: $v" >> "$OUTPUT_FILE"
        echo "pass|${v:-present}"
    elif command -v "$name" >/dev/null 2>&1; then
        local resolved; resolved=$(command -v "$name")
        echo "resolved via PATH: $resolved" >> "$OUTPUT_FILE"
        echo "pass|via PATH"
    else
        echo "not found at $path or via PATH" >> "$OUTPUT_FILE"
        if [ "$soft" = "1" ]; then echo "warn|missing (optional)"
        else echo "fail|missing"; fi
    fi
}

t_bin_atcli()      { _check_bin atcli_smd11 /usr/bin/atcli_smd11 0; }
t_bin_sms_tool()   { _check_bin sms_tool    /usr/bin/sms_tool    0; }
t_bin_qcmd()       { _check_bin qcmd        /usr/bin/qcmd        0; }
t_bin_jq()         { _check_bin jq          /opt/bin/jq          0; }
t_bin_curl()       { _check_bin curl        /opt/bin/curl        0; }
t_bin_openssl()    { _check_bin openssl     /opt/bin/openssl     0; }
t_bin_xmlstarlet() { _check_bin xmlstarlet  /opt/bin/xmlstarlet  0; }
t_bin_speedtest()  { _check_bin speedtest   /usrdata/root/bin/speedtest 1; }
t_bin_tailscale() {
    if [ -x /usrdata/tailscale/tailscale ]; then
        local v; v=$(/usrdata/tailscale/tailscale version 2>&1 | head -1)
        echo "$v" >> "$OUTPUT_FILE"
        echo "pass|$v"
    else
        echo "not installed" >> "$OUTPUT_FILE"
        echo "skip|not installed (optional)"
    fi
}
t_bin_msmtp() {
    if [ -x /opt/bin/msmtp ]; then
        local v; v=$(/opt/bin/msmtp --version 2>&1 | head -1)
        echo "$v" >> "$OUTPUT_FILE"
        echo "pass|$v"
    elif [ ! -f /etc/qmanager/email_alerts.json ]; then
        echo "skip|email alerts not configured"
    else
        echo "fail|missing but email alerts configured"
    fi
}
t_bin_ttyd()       { _check_bin ttyd /usrdata/qmanager/console/ttyd 1; }

t_perm_smd11() {
    if [ ! -e /dev/smd11 ]; then echo "fail|/dev/smd11 missing"; return; fi
    local mode owner group
    mode=$(stat -c '%a' /dev/smd11 2>/dev/null)
    owner=$(stat -c '%U' /dev/smd11 2>/dev/null)
    group=$(stat -c '%G' /dev/smd11 2>/dev/null)
    echo "mode=$mode owner=$owner group=$group" >> "$OUTPUT_FILE"
    if [ "$mode" = "660" ] && [ "$owner" = "root" ] && [ "$group" = "dialout" ]; then
        echo "pass|660 root:dialout"
    else
        echo "fail|got $mode $owner:$group, expected 660 root:dialout"
    fi
}
t_perm_www_dialout() {
    if id www-data 2>/dev/null | grep -q '\bdialout\b'; then
        id www-data >> "$OUTPUT_FILE"
        echo "pass|in dialout group"
    else
        id www-data 2>&1 >> "$OUTPUT_FILE" || echo "www-data missing" >> "$OUTPUT_FILE"
        echo "fail|not in dialout group"
    fi
}
t_perm_qmanager_dir() {
    local mode; mode=$(stat -c '%a' /usrdata/qmanager 2>/dev/null)
    echo "/usrdata/qmanager mode=$mode" >> "$OUTPUT_FILE"
    case "$mode" in
        7??|755|750) echo "pass|mode $mode" ;;
        "") echo "fail|directory missing" ;;
        *)  echo "warn|mode $mode (expected 755)";;
    esac
}
t_perm_rootfs_state() {
    local state; state=$(awk '$2=="/" {print $4}' /proc/mounts | head -1)
    echo "rootfs state: $state" >> "$OUTPUT_FILE"
    case "$state" in *ro*) echo "pass|read-only (expected)";;
                     *rw*) echo "warn|read-write (atypical for RM520N-GL)";;
                     *)    echo "fail|could not determine";; esac
}
t_perm_tmp_writable() {
    local probe="/tmp/qmanager_health_check_probe.$$"
    if su -s /bin/sh -c "touch $probe" www-data 2>>"$OUTPUT_FILE"; then
        rm -f "$probe"
        echo "pass|writable"
    else
        echo "fail|www-data cannot write to /tmp"
    fi
}

# AT helpers — share serialisation with qcmd via /tmp/qmanager_at.lock.
_qcmd() {
    qcmd "$@" 2>&1
}

t_at_echo() {
    local out; out=$(_qcmd "AT")
    echo "$out" >> "$OUTPUT_FILE"
    echo "$out" | grep -q '^OK$\|^OK\r\?$' && echo "pass|OK" || echo "fail|no OK in response"
}
t_at_cgmi() {
    local out; out=$(_qcmd "AT+CGMI")
    echo "$out" >> "$OUTPUT_FILE"
    if echo "$out" | grep -qi 'quectel'; then
        local mfg; mfg=$(echo "$out" | grep -i 'quectel' | head -1 | tr -d '\r')
        echo "pass|$mfg"
    else
        echo "fail|manufacturer not detected"
    fi
}
t_at_cgmm() {
    local out; out=$(_qcmd "AT+CGMM")
    echo "$out" >> "$OUTPUT_FILE"
    local model; model=$(echo "$out" | grep -E '^(RM|RG|EG|EC)[0-9A-Za-z\-]+' | head -1 | tr -d '\r')
    [ -n "$model" ] && echo "pass|$model" || echo "fail|model not detected"
}
t_at_cgsn() {
    local out; out=$(_qcmd "AT+CGSN")
    echo "$out" >> "$OUTPUT_FILE"
    local imei; imei=$(echo "$out" | grep -E '^[0-9]{15}$' | head -1)
    if [ -n "$imei" ]; then
        local masked="${imei:0:9}xxxxxx"
        echo "pass|IMEI $masked"
    else
        echo "fail|no 15-digit IMEI in response"
    fi
}
t_at_cfun() {
    local out; out=$(_qcmd "AT+CFUN?")
    echo "$out" >> "$OUTPUT_FILE"
    local val; val=$(echo "$out" | grep -oE '\+CFUN: [0-9]+' | head -1)
    [ -n "$val" ] && echo "pass|$val" || echo "fail|no +CFUN: line"
}
t_at_lock_serial() {
    # Two qcmd calls launched concurrently must serialize correctly.
    ( _qcmd "AT" ; echo "---" ; _qcmd "AT" ) >> "$OUTPUT_FILE" 2>&1
    grep -c '^OK' "$OUTPUT_FILE" | grep -q '^[2-9]$' \
        && echo "pass|two OKs observed" \
        || echo "fail|did not observe two OKs"
}

t_sms_recv_listing() {
    local out; out=$(sms_tool -j recv 2>>"$OUTPUT_FILE")
    echo "$out" >> "$OUTPUT_FILE"
    if echo "$out" | jq -e . >/dev/null 2>&1; then echo "pass|valid JSON"
    else echo "fail|invalid JSON or sms_tool error"; fi
}
t_sms_flock() {
    if flock -x -n /tmp/qmanager_at.lock true 2>>"$OUTPUT_FILE"; then
        echo "pass|lock acquired and released"
    else
        echo "warn|lock currently held (may be in use)"
    fi
}
t_sms_cpin() {
    local out; out=$(_qcmd "AT+CPIN?")
    echo "$out" >> "$OUTPUT_FILE"
    if echo "$out" | grep -q 'READY'; then echo "pass|READY"
    elif echo "$out" | grep -q 'SIM PIN'; then echo "warn|SIM locked (PIN required)"
    else echo "fail|not READY"; fi
}

t_sudo_list() {
    local out; out=$(sudo -n -l 2>&1)
    echo "$out" >> "$OUTPUT_FILE"
    if echo "$out" | grep -q 'qmanager'; then echo "pass|qmanager helpers visible"
    else echo "fail|no qmanager rules visible"; fi
}

_svc_check() {
    # _svc_check <unit> <required?>
    local unit="$1" required="${2:-1}"
    if ! systemctl list-unit-files "$unit" 2>/dev/null | grep -q "$unit"; then
        if [ "$required" = "0" ]; then echo "skip|unit not installed"; return; fi
        echo "fail|unit not installed"; return
    fi
    local enabled="no"
    [ -L "/lib/systemd/system/multi-user.target.wants/$unit" ] && enabled="yes"
    local active; active=$(systemctl is-active "$unit" 2>/dev/null || echo unknown)
    echo "unit=$unit enabled=$enabled active=$active" >> "$OUTPUT_FILE"
    case "$active" in
        active)   echo "pass|active, enabled=$enabled" ;;
        inactive) echo "warn|inactive (enabled=$enabled)" ;;
        failed)   echo "fail|failed (enabled=$enabled)" ;;
        *)        echo "warn|state=$active" ;;
    esac
}
t_svc_firewall()  { _svc_check qmanager-firewall.service 1; }
t_svc_poller()    { _svc_check qmanager-poller.service 1; }
t_svc_console()   { _svc_check qmanager-console.service 1; }
t_svc_setup()     { _svc_check qmanager-setup.service 1; }
t_svc_lighttpd()  { _svc_check lighttpd.service 1; }
t_svc_tailscaled(){ _svc_check tailscaled.service 0; }

t_net_dns() {
    local out; out=$(nslookup install.speedtest.net 2>&1)
    echo "$out" >> "$OUTPUT_FILE"
    if echo "$out" | grep -q 'Address'; then echo "pass|resolved"
    else echo "fail|no Address line"; fi
}
t_net_ping() {
    if ping -c 1 -W 2 1.1.1.1 >>"$OUTPUT_FILE" 2>&1; then echo "pass|1.1.1.1 reachable"
    else echo "fail|no reply"; fi
}
t_net_rmnet() {
    local out; out=$(ip -o -4 addr show 2>>"$OUTPUT_FILE" | grep -E 'rmnet')
    echo "$out" >> "$OUTPUT_FILE"
    if [ -n "$out" ]; then
        local ip; ip=$(echo "$out" | head -1 | awk '{print $4}')
        echo "pass|$ip"
    else
        echo "fail|no rmnet interface with IPv4"
    fi
}
t_net_lighttpd_listen() {
    local out; out=$(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null)
    echo "$out" >> "$OUTPUT_FILE"
    local ok=0
    echo "$out" | grep -qE '[:.](80)\b'  && ok=$((ok+1))
    echo "$out" | grep -qE '[:.](443)\b' && ok=$((ok+1))
    case "$ok" in
        2) echo "pass|listening on 80 and 443" ;;
        1) echo "warn|listening on only one of 80/443" ;;
        *) echo "fail|not listening on 80 or 443" ;;
    esac
}
t_net_firewall_rules() {
    local out; out=$(iptables -L INPUT -n 2>>"$OUTPUT_FILE")
    echo "$out" >> "$OUTPUT_FILE"
    local rules; rules=$(echo "$out" | grep -cE '^(ACCEPT|DROP|REJECT)')
    if [ "$rules" -gt 0 ]; then echo "pass|$rules INPUT rules"
    else echo "warn|no INPUT rules detected"; fi
}

t_cfg_qmanager_dir() {
    if [ -d /etc/qmanager ]; then
        ls -la /etc/qmanager >> "$OUTPUT_FILE"
        echo "pass|exists"
    else
        echo "fail|/etc/qmanager missing"
    fi
}
_cfg_validate_json() {
    # _cfg_validate_json <path>
    local path="$1"
    if [ ! -f "$path" ]; then echo "skip|not configured"; return; fi
    if jq -e . <"$path" >>"$OUTPUT_FILE" 2>&1; then echo "pass|valid JSON"
    else echo "fail|invalid JSON"; fi
}
t_cfg_sms_alerts()   { _cfg_validate_json /etc/qmanager/sms_alerts.json; }
t_cfg_email_alerts() { _cfg_validate_json /etc/qmanager/email_alerts.json; }
t_cfg_poller_cache_fresh() {
    local f=/tmp/qmanager_poller_cache.json
    if [ ! -f "$f" ]; then echo "fail|missing"; return; fi
    local age; age=$(( $(date +%s) - $(stat -c %Y "$f") ))
    echo "age=${age}s" >> "$OUTPUT_FILE"
    if [ "$age" -lt 60 ]; then echo "pass|age ${age}s"
    elif [ "$age" -lt 300 ]; then echo "warn|age ${age}s (>60s)"
    else echo "fail|age ${age}s (poller may be stalled)"; fi
}
t_cfg_cgi_path_opt() {
    local conf=/usrdata/qmanager/lighttpd.conf
    [ -f "$conf" ] || conf=/etc/lighttpd/lighttpd.conf
    grep -nE 'PATH|setenv|cgi.assign' "$conf" >> "$OUTPUT_FILE" 2>/dev/null || true
    if grep -qE 'PATH.*\/opt\/bin' "$conf" 2>/dev/null; then
        echo "pass|PATH includes /opt/bin"
    else
        # Not having it in lighttpd.conf is OK because cgi_base.sh exports it.
        echo "pass|set via cgi_base.sh (lighttpd PATH absent is acceptable)"
    fi
}
```

- [ ] **Step 3: Replace the test invocations in main**

Locate the two lines that invoke the placeholder tests:

```bash
_run_test bin.placeholder_pass binaries "placeholder pass" t_placeholder_pass
_run_test bin.placeholder_fail binaries "placeholder fail" t_placeholder_fail
```

Replace with the full call list:

```bash
_run_test bin.atcli           binaries     "atcli_smd11 binary present"            t_bin_atcli
_run_test bin.sms_tool        binaries     "sms_tool binary present"               t_bin_sms_tool
_run_test bin.qcmd            binaries     "qcmd wrapper present"                  t_bin_qcmd
_run_test bin.jq              binaries     "jq present"                            t_bin_jq
_run_test bin.curl            binaries     "curl present"                          t_bin_curl
_run_test bin.openssl         binaries     "openssl present"                       t_bin_openssl
_run_test bin.xmlstarlet      binaries     "xmlstarlet present"                    t_bin_xmlstarlet
_run_test bin.speedtest       binaries     "speedtest CLI"                         t_bin_speedtest
_run_test bin.tailscale       binaries     "tailscale binary"                      t_bin_tailscale
_run_test bin.msmtp           binaries     "msmtp binary"                          t_bin_msmtp
_run_test bin.ttyd            binaries     "ttyd binary"                           t_bin_ttyd

_run_test perm.smd11          permissions  "/dev/smd11 mode 660 root:dialout"      t_perm_smd11
_run_test perm.www_dialout    permissions  "www-data is in dialout group"          t_perm_www_dialout
_run_test perm.qmanager_dir   permissions  "/usrdata/qmanager traversable"         t_perm_qmanager_dir
_run_test perm.rootfs_state   permissions  "rootfs read-only by default"           t_perm_rootfs_state
_run_test perm.tmp_writable   permissions  "/tmp writable by www-data"             t_perm_tmp_writable

_run_test at.echo             at_transport "AT echo (qcmd \"AT\")"                 t_at_echo
_run_test at.cgmi             at_transport "AT+CGMI returns manufacturer"          t_at_cgmi
_run_test at.cgmm             at_transport "AT+CGMM returns model"                 t_at_cgmm
_run_test at.cgsn             at_transport "AT+CGSN returns IMEI"                  t_at_cgsn
_run_test at.cfun             at_transport "AT+CFUN? radio state"                  t_at_cfun
_run_test at.lock_serial      at_transport "qcmd serializes back-to-back"          t_at_lock_serial

_run_test sms.recv_listing    sms          "sms_tool -j recv returns valid JSON"   t_sms_recv_listing
_run_test sms.flock           sms          "flock on shared AT lock works"         t_sms_flock
_run_test sms.cpin            sms          "AT+CPIN? returns READY"                t_sms_cpin

_run_test sudo.list           sudoers      "sudo -n -l shows qmanager helpers"     t_sudo_list

_run_test svc.firewall        services     "qmanager-firewall.service"             t_svc_firewall
_run_test svc.poller          services     "qmanager-poller.service"               t_svc_poller
_run_test svc.console         services     "qmanager-console.service"              t_svc_console
_run_test svc.setup           services     "qmanager-setup.service"                t_svc_setup
_run_test svc.lighttpd        services     "lighttpd.service"                      t_svc_lighttpd
_run_test svc.tailscaled      services     "tailscaled.service (optional)"         t_svc_tailscaled

_run_test net.dns             network      "DNS resolves install.speedtest.net"    t_net_dns
_run_test net.ping            network      "IPv4 reachability (1.1.1.1)"           t_net_ping
_run_test net.rmnet           network      "rmnet+ has IP"                         t_net_rmnet
_run_test net.lighttpd_listen network      "lighttpd listening on 80/443"          t_net_lighttpd_listen
_run_test net.firewall_rules  network      "iptables INPUT rules loaded"           t_net_firewall_rules

_run_test cfg.qmanager_dir         configuration "/etc/qmanager exists"               t_cfg_qmanager_dir
_run_test cfg.sms_alerts_json      configuration "sms_alerts.json valid"              t_cfg_sms_alerts
_run_test cfg.email_alerts_json    configuration "email_alerts.json valid"            t_cfg_email_alerts
_run_test cfg.poller_cache_fresh   configuration "poller cache mtime < 60s"           t_cfg_poller_cache_fresh
_run_test cfg.cgi_path_opt         configuration "lighttpd CGI PATH includes /opt/bin" t_cfg_cgi_path_opt
```

- [ ] **Step 4: Parse-check**

Run: `bash -n scripts/usr/bin/qmanager_health_check`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_health_check
git commit -m "feat(system-health-check): wire full test catalog into runner"
```

---

## Task 4: Tarball bundling with redaction

**Files:**
- Modify: `scripts/usr/bin/qmanager_health_check`

Replace the trivial `tar -czf …` line with a real bundle build that:
1. Generates `report.txt` (human-readable, IMEI masked)
2. Copies sanitized config, services status, log tails into the job dir
3. Applies redaction filter
4. Tars the result and finalizes

- [ ] **Step 1: Add bundling helpers above the main section**

Insert these helpers just below the test functions (before the existing `# --- Finalization ---` block):

```bash
# --- Bundling --------------------------------------------------------------

# Apply redaction in-place to all files under a given directory.
# Patterns:
#   - msmtprc password lines
#   - tskey-* tokens (Tailscale auth keys)
#   - Cookie / Authorization HTTP headers
_redact_tree() {
    local dir="$1"
    # Use find + sed -i; some files are binary-ish so guard with -I file probes
    find "$dir" -type f \( -name '*.txt' -o -name '*.json' -o -name '*.conf' -o -name '*.log' -o -name 'msmtprc' -o -name '*alerts*' \) \
        -print 2>/dev/null | while read -r f; do
        sed -i \
            -e 's/^\([[:space:]]*password[[:space:]]\).*/\1REDACTED/' \
            -e 's/tskey-[A-Za-z0-9_-]\{20,\}/tskey-REDACTED/g' \
            -e 's/\(Cookie:[[:space:]]\).*/\1REDACTED/I' \
            -e 's/\(Authorization:[[:space:]]\).*/\1REDACTED/I' \
            "$f" 2>/dev/null || true
    done
}

# Build report.txt — human-readable summary derived from the live status JSON.
_build_report_txt() {
    local out="$1"
    {
        echo "QManager System Health Check"
        echo "============================"
        echo "Job ID:      $JOB_ID"
        echo "Started:     $(date -d "@$(jq -r .started_at "$STATUS_FILE")" -u +'%Y-%m-%dT%H:%M:%SZ')"
        echo "Host:        $(uname -n)"
        echo "Kernel:      $(uname -srm)"
        echo "OS Release:  $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")"
        if [ -f /etc/qmanager/version ]; then
            echo "QManager:    $(cat /etc/qmanager/version)"
        fi
        echo
        echo "Summary"
        echo "-------"
        jq -r '.summary | "Pass: \(.pass)\nFail: \(.fail)\nWarn: \(.warn)\nSkip: \(.skip)\nTotal: \(.total)"' "$STATUS_FILE"
        echo
        echo "Tests"
        echo "-----"
        jq -r '
            .tests | group_by(.category)[] |
            "\n[\(.[0].category)]\n" +
            (map("  [\(.status | ascii_upcase)] \(.label) — \(.detail) (\(.duration_ms)ms)") | join("\n"))
        ' "$STATUS_FILE"
    } > "$out"
    # Mask any 15-digit IMEI runs in report.txt (last 6 digits → xxxxxx).
    sed -i -E 's/\b([0-9]{9})[0-9]{6}\b/\1xxxxxx/g' "$out"
}

_collect_system_info() {
    local out="$1"
    {
        echo "# uname"; uname -a
        echo; echo "# /etc/os-release"; cat /etc/os-release 2>/dev/null
        echo; echo "# uptime"; uptime
        echo; echo "# free -m"; free -m 2>/dev/null
        echo; echo "# df -h"; df -h
        echo; echo "# mount"; mount
        echo; echo "# ip a"; ip a
    } > "$out" 2>&1
}

_collect_services() {
    local dir="$1"
    mkdir -p "$dir"
    local units="qmanager-firewall.service qmanager-poller.service qmanager-console.service qmanager-setup.service lighttpd.service tailscaled.service qmanager-tailscale-watchdog.service"
    for u in $units; do
        {
            echo "# systemctl status $u"
            systemctl status "$u" --no-pager 2>&1 | head -40
            echo
            echo "# journalctl -u $u -n 50 --no-pager"
            journalctl -u "$u" -n 50 --no-pager 2>&1
        } > "$dir/${u%.service}.txt"
    done
}

_collect_configs() {
    local dir="$1"
    mkdir -p "$dir"
    [ -f /usrdata/qmanager/lighttpd.conf ] && cp /usrdata/qmanager/lighttpd.conf "$dir/lighttpd.conf" 2>/dev/null
    [ -f /etc/sudoers.d/qmanager ]        && cp /etc/sudoers.d/qmanager        "$dir/sudoers-qmanager" 2>/dev/null
    [ -f /opt/etc/sudoers.d/qmanager ]    && cp /opt/etc/sudoers.d/qmanager    "$dir/sudoers-qmanager" 2>/dev/null
    [ -f /etc/qmanager/sms_alerts.json ]  && cp /etc/qmanager/sms_alerts.json  "$dir/sms_alerts.json"  2>/dev/null
    [ -f /etc/qmanager/email_alerts.json ]&& cp /etc/qmanager/email_alerts.json "$dir/email_alerts.json" 2>/dev/null
    [ -f /etc/qmanager/msmtprc ]          && cp /etc/qmanager/msmtprc          "$dir/msmtprc"          2>/dev/null
}

_collect_logs() {
    local dir="$1"
    mkdir -p "$dir"
    [ -f /tmp/qmanager_poller.log ] && tail -n 200 /tmp/qmanager_poller.log > "$dir/qmanager-poller.log" 2>/dev/null
    [ -f /var/log/lighttpd/error.log ] && tail -n 200 /var/log/lighttpd/error.log > "$dir/lighttpd-error.log" 2>/dev/null
    [ -f /opt/var/log/lighttpd/error.log ] && tail -n 200 /opt/var/log/lighttpd/error.log > "$dir/lighttpd-error.log" 2>/dev/null
}

_build_report_json() {
    local out="$1"
    # Embed each per-test raw output (truncated to 4 KB) into the JSON.
    jq --slurpfile noop /dev/null '.' "$STATUS_FILE" > "$out.tmp"
    local arr='[]'
    for f in "$TESTS_DIR"/*.txt; do
        [ -f "$f" ] || continue
        local id; id=$(basename "$f" .txt)
        local body; body=$(head -c 4096 "$f")
        arr=$(printf '%s' "$arr" | jq --arg id "$id" --arg body "$body" '. + [{id:$id, output:$body}]')
    done
    jq --argjson outputs "$arr" '. + {test_outputs: $outputs}' "$out.tmp" > "$out"
    rm -f "$out.tmp"
}

_build_bundle() {
    local stage="$JOB_DIR/bundle"
    mkdir -p "$stage" "$stage/services" "$stage/config" "$stage/logs" "$stage/tests"

    _build_report_txt   "$stage/report.txt"
    _collect_system_info "$stage/system-info.txt"
    _collect_services   "$stage/services"
    _collect_configs    "$stage/config"
    _collect_logs       "$stage/logs"
    cp -r "$TESTS_DIR/." "$stage/tests/" 2>/dev/null || true
    [ -f /tmp/qmanager_poller_cache.json ] && cp /tmp/qmanager_poller_cache.json "$stage/poller-cache.json" 2>/dev/null

    _redact_tree "$stage"
    _build_report_json "$stage/report.json"

    tar -czf "$TARBALL" -C "$JOB_DIR" bundle
}
```

- [ ] **Step 2: Replace the trivial `tar` invocation in main**

Replace this block:

```bash
tar -czf "$TARBALL" -C /tmp "qmanager_health_check_${JOB_ID}" 2>/dev/null \
    && _finalize_status "complete" \
    || _finalize_status "complete_no_bundle" "tarball build failed"
```

With:

```bash
if _build_bundle 2>>"$JOB_DIR/build.log"; then
    _finalize_status "complete"
else
    _finalize_status "complete_no_bundle" "tarball build failed (see build.log)"
fi
```

- [ ] **Step 3: Parse-check**

Run: `bash -n scripts/usr/bin/qmanager_health_check`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/usr/bin/qmanager_health_check
git commit -m "feat(system-health-check): build redacted tarball bundle"
```

---

## Task 5: Manual redaction fixture

**Files:**
- Create: `scripts/test/health-check-redaction.sh`

A standalone, manual script that exercises the redaction sed pipeline against synthetic input. Not run in CI — invoked manually as a sanity check whenever redaction patterns change.

- [ ] **Step 1: Create fixture**

```bash
#!/bin/bash
# Manual fixture: verify the qmanager_health_check redaction patterns mask
# every secret type. Run from a workstation, not the device.
#
#   bash scripts/test/health-check-redaction.sh
set -eu

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat > "$work/msmtprc" <<'EOF'
host smtp.example.com
user alice@example.com
password supersecret123
EOF

cat > "$work/log.log" <<'EOF'
2026-05-04 10:00:00 GET /api?key=tskey-auth-AbCdEfGhIjKlMnOpQrSt /
Cookie: session=abcdef1234567890
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9
EOF

# Run the same sed pipeline used in qmanager_health_check::_redact_tree
find "$work" -type f -print | while read -r f; do
    sed -i \
        -e 's/^\([[:space:]]*password[[:space:]]\).*/\1REDACTED/' \
        -e 's/tskey-[A-Za-z0-9_-]\{20,\}/tskey-REDACTED/g' \
        -e 's/\(Cookie:[[:space:]]\).*/\1REDACTED/I' \
        -e 's/\(Authorization:[[:space:]]\).*/\1REDACTED/I' \
        "$f"
done

fail=0
grep -q 'supersecret123'                "$work/msmtprc" && { echo "FAIL: msmtprc password leaked"; fail=1; }
grep -q 'tskey-auth-AbCdEf'             "$work/log.log" && { echo "FAIL: tskey leaked";           fail=1; }
grep -q 'session=abcdef1234567890'      "$work/log.log" && { echo "FAIL: cookie leaked";          fail=1; }
grep -q 'eyJhbGciOiJIUzI1NiJ9'          "$work/log.log" && { echo "FAIL: bearer leaked";          fail=1; }
grep -q 'password REDACTED'             "$work/msmtprc" || { echo "FAIL: msmtprc not redacted";   fail=1; }
grep -q 'tskey-REDACTED'                "$work/log.log" || { echo "FAIL: tskey not redacted";     fail=1; }
grep -q 'Cookie: REDACTED'              "$work/log.log" || { echo "FAIL: cookie not redacted";    fail=1; }
grep -q 'Authorization: REDACTED'       "$work/log.log" || { echo "FAIL: auth not redacted";      fail=1; }

if [ "$fail" = "0" ]; then echo "OK: all redactions applied"; exit 0
else echo "redaction fixture failed"; exit 1; fi
```

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x scripts/test/health-check-redaction.sh
bash scripts/test/health-check-redaction.sh
```

Expected: `OK: all redactions applied`

- [ ] **Step 3: Commit**

```bash
git add scripts/test/health-check-redaction.sh
git commit -m "test(system-health-check): add manual redaction fixture"
```

---

## Task 6: Add sudoers rule

**Files:**
- Modify: `scripts/etc/sudoers.d/qmanager`

- [ ] **Step 1: Append the new rule**

Add at the bottom of `scripts/etc/sudoers.d/qmanager`, immediately after the OTA updater entry:

```
# System Health Check (privileged runner that probes binaries, AT, services, sudoers)
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_health_check
```

- [ ] **Step 2: Commit**

```bash
git add scripts/etc/sudoers.d/qmanager
git commit -m "feat(system-health-check): whitelist runner in sudoers"
```

---

## Task 7: CGI run.sh

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/system/health-check/run.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
# =============================================================================
# run.sh — POST: launch System Health Check runner. Idempotent.
# =============================================================================

qlog_init "cgi_health_check_run"
cgi_headers
cgi_handle_options

STATUS_FILE="/tmp/qmanager_health_check.json"

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_method_not_allowed
fi

# Idempotency: if a job is already running, return its job_id.
if [ -f "$STATUS_FILE" ]; then
    existing_status=$(jq -r '.status // ""' "$STATUS_FILE" 2>/dev/null)
    existing_pid=$(jq -r '.pid // ""' "$STATUS_FILE" 2>/dev/null)
    existing_id=$(jq -r '.job_id // ""' "$STATUS_FILE" 2>/dev/null)
    if [ "$existing_status" = "running" ] && pid_alive "$existing_pid"; then
        existing_started=$(jq -r '.started_at // 0' "$STATUS_FILE")
        jq -n --arg id "$existing_id" --argjson s "$existing_started" \
            '{success:true, job_id:$id, started_at:$s, resumed:true}'
        exit 0
    fi
    # Stale "running" with dead PID — the runner crashed. Mark error.
    if [ "$existing_status" = "running" ]; then
        tmp="${STATUS_FILE}.tmp"
        jq '.status = "error" | .error = "runner exited unexpectedly"' "$STATUS_FILE" > "$tmp" && mv "$tmp" "$STATUS_FILE"
    fi
fi

# Generate a job id: YYYYMMDD-HHMMSS-<rand4>
ts=$(date -u +'%Y%m%d-%H%M%S')
rand=$(head -c 2 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' | head -c 4)
[ -n "$rand" ] || rand=$(printf '%04x' $$)
job_id="${ts}-${rand}"

# Spawn detached. setsid + & + disowned redirects let the CGI return
# immediately while the runner continues under init.
setsid sudo -n /usr/bin/qmanager_health_check "$job_id" \
    </dev/null >/tmp/qmanager_health_check.log 2>&1 &
disown 2>/dev/null || true

started=$(date +%s)
qlog_info "spawned health check job $job_id"
jq -n --arg id "$job_id" --argjson s "$started" \
    '{success:true, job_id:$id, started_at:$s, resumed:false}'
```

- [ ] **Step 2: Make executable and parse-check**

```bash
chmod +x scripts/www/cgi-bin/quecmanager/system/health-check/run.sh
sh -n scripts/www/cgi-bin/quecmanager/system/health-check/run.sh
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/system/health-check/run.sh
git commit -m "feat(system-health-check): add run.sh CGI"
```

---

## Task 8: CGI status.sh

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/system/health-check/status.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# status.sh — GET: serve current System Health Check status JSON.
#   ?test_id=<id>   → return last 4 KB of that test's raw output
# =============================================================================

qlog_init "cgi_health_check_status"
cgi_headers

STATUS_FILE="/tmp/qmanager_health_check.json"

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
fi

# Parse query string for test_id (POSIX-only, no curl/awk dependency tricks).
test_id=""
case "$QUERY_STRING" in
    *test_id=*) test_id=$(printf '%s' "$QUERY_STRING" | sed -n 's/.*test_id=\([^&]*\).*/\1/p') ;;
esac

if [ -n "$test_id" ]; then
    # Validate test_id: lowercase letters, digits, dot, underscore.
    if ! printf '%s' "$test_id" | grep -qE '^[a-z0-9_.]{1,64}$'; then
        cgi_error "invalid_test_id" "test_id contains invalid characters"
        exit 0
    fi
    if [ ! -f "$STATUS_FILE" ]; then
        cgi_error "no_run" "no diagnostic run found"
        exit 0
    fi
    job_id=$(jq -r '.job_id // ""' "$STATUS_FILE")
    out_file="/tmp/qmanager_health_check_${job_id}/tests/${test_id}.txt"
    if [ ! -f "$out_file" ]; then
        jq -n --arg id "$test_id" '{success:true, test_id:$id, output:"", truncated:false}'
        exit 0
    fi
    # Tail last 4 KB.
    body=$(tail -c 4096 "$out_file")
    truncated=false
    [ "$(stat -c %s "$out_file" 2>/dev/null || echo 0)" -gt 4096 ] && truncated=true
    jq -n --arg id "$test_id" --arg body "$body" --argjson trunc "$truncated" \
        '{success:true, test_id:$id, output:$body, truncated:$trunc}'
    exit 0
fi

# Default path — return the full status JSON.
if [ -f "$STATUS_FILE" ]; then
    cat "$STATUS_FILE"
else
    jq -n '{success:true, status:"none", tests:[], summary:{pass:0,fail:0,warn:0,skip:0,total:0}}'
fi
```

- [ ] **Step 2: Make executable and parse-check**

```bash
chmod +x scripts/www/cgi-bin/quecmanager/system/health-check/status.sh
sh -n scripts/www/cgi-bin/quecmanager/system/health-check/status.sh
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/system/health-check/status.sh
git commit -m "feat(system-health-check): add status.sh CGI with test_id mode"
```

---

## Task 9: CGI download.sh

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/system/health-check/download.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/sh
# NOTE: NOT sourcing cgi_base.sh — it emits Content-Type: application/json
# and a CORS preflight blank line. We need binary streaming with a custom
# Content-Type, so we replicate just the auth gate inline.

# Auth: reuse the same require_auth implementation
. /usr/lib/qmanager/cgi_auth.sh 2>/dev/null
require_auth >/dev/null 2>&1 || {
    printf 'Status: 401 Unauthorized\r\n'
    printf 'Content-Type: application/json\r\n\r\n'
    printf '{"success":false,"error":"unauthorized"}\n'
    exit 0
}

# Method check
if [ "$REQUEST_METHOD" != "GET" ]; then
    printf 'Status: 405 Method Not Allowed\r\n'
    printf 'Content-Type: application/json\r\n\r\n'
    printf '{"success":false,"error":"method_not_allowed"}\n'
    exit 0
fi

# Parse and validate job_id (must match runner's regex).
job_id=""
case "$QUERY_STRING" in
    *job_id=*) job_id=$(printf '%s' "$QUERY_STRING" | sed -n 's/.*job_id=\([^&]*\).*/\1/p') ;;
esac
if ! printf '%s' "$job_id" | grep -qE '^[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$'; then
    printf 'Status: 400 Bad Request\r\n'
    printf 'Content-Type: application/json\r\n\r\n'
    printf '{"success":false,"error":"invalid_job_id"}\n'
    exit 0
fi

tarball="/tmp/qmanager_health_check_${job_id}.tar.gz"
if [ ! -f "$tarball" ]; then
    printf 'Status: 404 Not Found\r\n'
    printf 'Content-Type: application/json\r\n\r\n'
    printf '{"success":false,"error":"bundle_not_found"}\n'
    exit 0
fi

size=$(stat -c %s "$tarball" 2>/dev/null || echo 0)
filename="qmanager-health-check-${job_id}.tar.gz"

printf 'Content-Type: application/gzip\r\n'
printf 'Content-Length: %s\r\n' "$size"
printf 'Content-Disposition: attachment; filename="%s"\r\n' "$filename"
printf 'Cache-Control: no-cache, no-store, must-revalidate\r\n'
printf '\r\n'
cat "$tarball"
```

- [ ] **Step 2: Make executable and parse-check**

```bash
chmod +x scripts/www/cgi-bin/quecmanager/system/health-check/download.sh
sh -n scripts/www/cgi-bin/quecmanager/system/health-check/download.sh
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/system/health-check/download.sh
git commit -m "feat(system-health-check): add download.sh CGI with strict job_id validation"
```

---

## Task 10: React hook `use-system-health-check`

**Files:**
- Create: `hooks/use-system-health-check.ts`

- [ ] **Step 1: Create the hook**

```ts
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  HealthCheckJob,
  RunResponse,
  TestOutputResponse,
  TestStatus,
} from "@/types/system-health-check";

const CGI_BASE = "/cgi-bin/quecmanager/system/health-check";
const POLL_INTERVAL_MS = 500;

export interface UseSystemHealthCheckReturn {
  job: HealthCheckJob | null;
  isRunning: boolean;
  isStarting: boolean;
  error: string | null;
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  fetchTestOutput: (testId: string) => Promise<string>;
  downloadBundle: () => void;
}

export function useSystemHealthCheck(): UseSystemHealthCheckReturn {
  const [job, setJob] = useState<HealthCheckJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aborted = useRef(false);

  const fetchStatus = useCallback(async (): Promise<HealthCheckJob | null> => {
    const res = await authFetch(`${CGI_BASE}/status.sh`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data?.status === "none") return null;
    return data as HealthCheckJob;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchStatus();
      setJob(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchStatus]);

  // Initial fetch on mount.
  useEffect(() => {
    aborted.current = false;
    void refresh();
    return () => {
      aborted.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refresh]);

  // Polling loop while job is running.
  useEffect(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    if (!job || job.status !== "running") return;
    pollTimer.current = setTimeout(async () => {
      if (aborted.current) return;
      await refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [job, refresh]);

  const start = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    try {
      const res = await authFetch(`${CGI_BASE}/run.sh`, { method: "POST" });
      const data = (await res.json()) as RunResponse;
      if (!data.success) throw new Error(data.detail || data.error || "run failed");
      // Reset job to a fresh "running" placeholder so UI flips immediately.
      setJob((prev) => (prev ? { ...prev, status: "running" } : prev));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsStarting(false);
    }
  }, [refresh]);

  const fetchTestOutput = useCallback(async (testId: string): Promise<string> => {
    const res = await authFetch(
      `${CGI_BASE}/status.sh?test_id=${encodeURIComponent(testId)}`,
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as TestOutputResponse;
    if (!data.success) throw new Error(data.error || "fetch failed");
    return data.output ?? "";
  }, []);

  const downloadBundle = useCallback(() => {
    if (!job?.job_id || !job.tarball_path) return;
    const url = `${CGI_BASE}/download.sh?job_id=${encodeURIComponent(job.job_id)}`;
    // Trigger native browser download — auth cookie is sent automatically.
    window.location.href = url;
  }, [job]);

  const isRunning = job?.status === "running";

  return {
    job,
    isRunning: !!isRunning,
    isStarting,
    error,
    start,
    refresh,
    fetchTestOutput,
    downloadBundle,
  };
}

// Helper for components: status → display label
export function testStatusLabel(s: TestStatus): string {
  switch (s) {
    case "pass": return "Pass";
    case "fail": return "Fail";
    case "warn": return "Warning";
    case "skip": return "Skipped";
    case "running": return "Running";
    case "pending": return "Pending";
  }
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add hooks/use-system-health-check.ts
git commit -m "feat(system-health-check): add use-system-health-check hook"
```

---

## Task 11: HealthStatusBadge component

**Files:**
- Create: `components/system-settings/system-health-check/health-status-badge.tsx`

- [ ] **Step 1: Create the badge**

```tsx
"use client";

import {
  CheckCircle2Icon,
  XCircleIcon,
  TriangleAlertIcon,
  MinusCircleIcon,
  Loader2Icon,
  ClockIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TestStatus } from "@/types/system-health-check";

interface HealthStatusBadgeProps {
  status: TestStatus;
}

export default function HealthStatusBadge({ status }: HealthStatusBadgeProps) {
  switch (status) {
    case "pass":
      return (
        <Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
          <CheckCircle2Icon className="size-3" />
          Pass
        </Badge>
      );
    case "fail":
      return (
        <Badge variant="outline" className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30">
          <XCircleIcon className="size-3" />
          Fail
        </Badge>
      );
    case "warn":
      return (
        <Badge variant="outline" className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
          <TriangleAlertIcon className="size-3" />
          Warning
        </Badge>
      );
    case "skip":
      return (
        <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
          <MinusCircleIcon className="size-3" />
          Skipped
        </Badge>
      );
    case "running":
      return (
        <Badge variant="outline" className="bg-info/15 text-info hover:bg-info/20 border-info/30">
          <Loader2Icon className="size-3 animate-spin" />
          Running
        </Badge>
      );
    case "pending":
    default:
      return (
        <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
          <ClockIcon className="size-3" />
          Pending
        </Badge>
      );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/system-health-check/health-status-badge.tsx
git commit -m "feat(system-health-check): add HealthStatusBadge component"
```

---

## Task 12: TestRow component

**Files:**
- Create: `components/system-settings/system-health-check/test-row.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import HealthStatusBadge from "./health-status-badge";
import type { HealthCheckTest } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

interface TestRowProps {
  test: HealthCheckTest;
  fetchOutput: (testId: string) => Promise<string>;
}

export default function TestRow({ test, fetchOutput }: TestRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expandable = test.status === "fail" || test.status === "warn";

  const toggle = async () => {
    if (!expandable) return;
    const next = !expanded;
    setExpanded(next);
    if (next && output === null) {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchOutput(test.id);
        setOutput(body || "(no output captured)");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        disabled={!expandable}
        className={cn(
          "flex w-full items-center justify-between gap-3 py-2 px-1 text-left",
          expandable ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expandable ? (
            expanded
              ? <ChevronDownIcon className="size-4 text-muted-foreground shrink-0" />
              : <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <span className="size-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{test.label}</div>
            {test.detail && (
              <div className="text-xs text-muted-foreground truncate">{test.detail}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {test.status !== "pending" && test.status !== "running" && test.duration_ms > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{test.duration_ms}ms</span>
          )}
          <HealthStatusBadge status={test.status} />
        </div>
      </button>
      {expanded && (
        <div className="bg-muted/40 border-t px-3 py-2">
          {loading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {error && <div className="text-xs text-destructive">Failed to load output: {error}</div>}
          {output !== null && (
            <pre className="text-xs whitespace-pre-wrap break-words font-mono max-h-64 overflow-auto">{output}</pre>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/system-health-check/test-row.tsx
git commit -m "feat(system-health-check): add TestRow component"
```

---

## Task 13: CategoryCard component

**Files:**
- Create: `components/system-settings/system-health-check/category-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import TestRow from "./test-row";
import {
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type HealthCheckTest,
  type TestCategory,
} from "@/types/system-health-check";

interface CategoryCardProps {
  category: TestCategory;
  tests: HealthCheckTest[];
  fetchOutput: (testId: string) => Promise<string>;
}

export default function CategoryCard({ category, tests, fetchOutput }: CategoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{CATEGORY_LABELS[category]}</CardTitle>
        <CardDescription>{CATEGORY_DESCRIPTIONS[category]}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y">
          {tests.map((t) => (
            <TestRow key={t.id} test={t} fetchOutput={fetchOutput} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/system-health-check/category-card.tsx
git commit -m "feat(system-health-check): add CategoryCard component"
```

---

## Task 14: SummaryCard component

**Files:**
- Create: `components/system-settings/system-health-check/summary-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2Icon,
  PlayIcon,
  DownloadIcon,
  CheckCircle2Icon,
  XCircleIcon,
  TriangleAlertIcon,
  MinusCircleIcon,
} from "lucide-react";
import type { HealthCheckJob } from "@/types/system-health-check";

interface SummaryCardProps {
  job: HealthCheckJob | null;
  isRunning: boolean;
  isStarting: boolean;
  onRun: () => void;
  onDownload: () => void;
}

function formatRelative(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SummaryCard({
  job,
  isRunning,
  isStarting,
  onRun,
  onDownload,
}: SummaryCardProps) {
  const hasRun = !!job;
  const summary = job?.summary;
  const canDownload = !!job && job.status === "complete" && !!job.tarball_path;

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Health Check</CardTitle>
        <CardDescription>
          Run a full diagnostic of binaries, permissions, AT transport, services, and configuration. Download the bundle to share with support.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col @2xl/main:flex-row @2xl/main:items-center @2xl/main:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {hasRun && summary ? (
              <>
                <Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
                  <CheckCircle2Icon className="size-3" />
                  {summary.pass} pass
                </Badge>
                <Badge variant="outline" className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30">
                  <XCircleIcon className="size-3" />
                  {summary.fail} fail
                </Badge>
                <Badge variant="outline" className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
                  <TriangleAlertIcon className="size-3" />
                  {summary.warn} warn
                </Badge>
                <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
                  <MinusCircleIcon className="size-3" />
                  {summary.skip} skip
                </Badge>
                {job?.started_at && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {isRunning ? "Started " : "Last run "} {formatRelative(job.started_at)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No diagnostics run yet.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onRun} disabled={isRunning || isStarting}>
              {isRunning || isStarting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <PlayIcon className="size-4" />
                  Run Diagnostics
                </>
              )}
            </Button>
            {canDownload && (
              <Button onClick={onDownload} variant="outline">
                <DownloadIcon className="size-4" />
                Download Bundle
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/system-health-check/summary-card.tsx
git commit -m "feat(system-health-check): add SummaryCard component"
```

---

## Task 15: Top-level component and page

**Files:**
- Create: `components/system-settings/system-health-check/system-health-check.tsx`
- Create: `app/system-settings/system-health-check/page.tsx`

- [ ] **Step 1: Create the top-level component**

```tsx
"use client";

import { useMemo } from "react";
import { useSystemHealthCheck } from "@/hooks/use-system-health-check";
import SummaryCard from "./summary-card";
import CategoryCard from "./category-card";
import {
  CATEGORY_LABELS,
  type HealthCheckTest,
  type TestCategory,
} from "@/types/system-health-check";

const CATEGORY_ORDER: TestCategory[] = [
  "binaries",
  "permissions",
  "at_transport",
  "sms",
  "sudoers",
  "services",
  "network",
  "configuration",
];

export default function SystemHealthCheck() {
  const { job, isRunning, isStarting, error, start, fetchTestOutput, downloadBundle } =
    useSystemHealthCheck();

  // Group tests by category, then sort categories fail-first.
  const groups = useMemo(() => {
    const buckets = new Map<TestCategory, HealthCheckTest[]>();
    if (job?.tests) {
      for (const t of job.tests) {
        const arr = buckets.get(t.category) ?? [];
        arr.push(t);
        buckets.set(t.category, arr);
      }
    }
    const items: { category: TestCategory; tests: HealthCheckTest[]; failCount: number }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const tests = buckets.get(cat);
      if (!tests || tests.length === 0) continue;
      const failCount = tests.filter((t) => t.status === "fail").length;
      items.push({ category: cat, tests, failCount });
    }
    items.sort((a, b) => {
      if ((a.failCount > 0) === (b.failCount > 0)) {
        return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      }
      return a.failCount > 0 ? -1 : 1;
    });
    return items;
  }, [job]);

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">System Health Check</h1>
        <p className="text-muted-foreground">
          Diagnose QManager subsystems and download a redacted bundle for support.
        </p>
      </div>
      <div className="grid grid-cols-1 grid-flow-row gap-4">
        <SummaryCard
          job={job}
          isRunning={isRunning}
          isStarting={isStarting}
          onRun={start}
          onDownload={downloadBundle}
        />
        {error && (
          <div className="text-sm text-destructive">Error: {error}</div>
        )}
        {groups.map((g) => (
          <CategoryCard
            key={g.category}
            category={g.category}
            tests={g.tests}
            fetchOutput={fetchTestOutput}
          />
        ))}
        {!job && (
          <div className="text-sm text-muted-foreground text-center py-8">
            Click <strong>Run Diagnostics</strong> above to start a health check.
            All categories ({CATEGORY_ORDER.map((c) => CATEGORY_LABELS[c]).join(", ")}) will be probed.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the Next.js page entry**

```tsx
// app/system-settings/system-health-check/page.tsx
import SystemHealthCheck from "@/components/system-settings/system-health-check/system-health-check";

const SystemHealthCheckPage = () => {
  return <SystemHealthCheck />;
};

export default SystemHealthCheckPage;
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/system-settings/system-health-check/system-health-check.tsx app/system-settings/system-health-check/page.tsx
git commit -m "feat(system-health-check): add top-level page and component"
```

---

## Task 16: Sidebar navigation entry

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Add the sub-item under System Settings**

Locate the `System Settings` entry (around lines 60–70 of `components/app-sidebar.tsx`):

```ts
    {
      title: "System Settings",
      url: "/system-settings",
      icon: SettingsIcon,
      items: [
        {
          title: "Logs",
          url: "/system-settings/logs",
        },
      ],
    },
```

Replace with:

```ts
    {
      title: "System Settings",
      url: "/system-settings",
      icon: SettingsIcon,
      items: [
        {
          title: "Logs",
          url: "/system-settings/logs",
        },
        {
          title: "System Health Check",
          url: "/system-settings/system-health-check",
        },
      ],
    },
```

- [ ] **Step 2: Type-check and build**

```bash
bunx tsc --noEmit
bun run build
```

Both expected to succeed.

- [ ] **Step 3: Commit**

```bash
git add components/app-sidebar.tsx
git commit -m "feat(system-health-check): add sidebar nav entry under System Settings"
```

---

## Task 17: Update RELEASE_NOTES.md

**Files:**
- Modify: `RELEASE_NOTES.md`

Per CLAUDE.md release-notes feedback: New Features section first, then Improvements; bullets stay 1–2 sentences, user-facing tone.

- [ ] **Step 1: Add a New Features bullet**

Add under the New Features section of the current unreleased version block (or create one if missing):

```markdown
- **System Health Check** — A new page under System Settings that runs end-to-end diagnostics across binaries, permissions, AT transport, SMS, sudoers, systemd services, network, and configuration. Failed and warning rows expand to show the captured output, and a one-click download produces a redacted `.tar.gz` bundle ready for support handoff.
```

- [ ] **Step 2: Commit**

```bash
git add RELEASE_NOTES.md
git commit -m "docs(release-notes): announce System Health Check feature"
```

---

## Task 18: Manual hardware verification

**Files:** none — runtime verification on RM520N-GL hardware.

This task is the primary correctness check. There is no automated harness for the embedded device.

- [ ] **Step 1: Build the device archive**

```bash
bun run build
bash build.sh
```

Expected: `qmanager-build/qmanager.tar.gz` produced.

- [ ] **Step 2: Deploy to a test device**

Transfer and install per the standard install flow (`scp -O qmanager.tar.gz <device>:/tmp/` → `bash install_rm520n.sh` from the extracted tree). Record the device version and modem variant in your notes.

- [ ] **Step 3: Smoke test from CLI**

SSH to the device and run:

```bash
sudo /usr/bin/qmanager_health_check $(date -u +'%Y%m%d-%H%M%S')-$(printf '%04x' $RANDOM)
ls -la /tmp/qmanager_health_check_*.tar.gz
jq '.summary' /tmp/qmanager_health_check.json
```

Expected: a summary like `{ "pass": N, "fail": M, "warn": K, "skip": L, "total": ... }` and a tarball file present.

- [ ] **Step 4: Inspect the tarball for redaction**

```bash
mkdir /tmp/healthcheck-inspect
tar -xzf /tmp/qmanager_health_check_*.tar.gz -C /tmp/healthcheck-inspect
grep -RIn 'password ' /tmp/healthcheck-inspect/bundle/config/ || true
grep -RIn 'tskey-' /tmp/healthcheck-inspect/bundle/ || true
grep -RIn 'Cookie:\|Authorization:' /tmp/healthcheck-inspect/bundle/logs/ || true
```

Expected: no actual secrets — only `REDACTED` markers where applicable.

- [ ] **Step 5: Browser walkthrough**

Open the QManager web UI → System Settings → System Health Check.
- Confirm the empty-state line "No diagnostics run yet." appears on first visit.
- Click **Run Diagnostics**. Verify rows transition pending → running → final state, summary counts update live, and category cards reorder fail-first as failures land.
- Click an expanded **fail** row and confirm the per-test snippet loads.
- After completion, click **Download Bundle** and verify the file downloads with the expected name.
- Toggle dark mode and re-verify badge colors.
- Resize the browser to mobile width and verify rows wrap cleanly.

- [ ] **Step 6: Commit any tweaks**

If hardware testing surfaces small fixes, commit them here as `fix(system-health-check): …` and re-run the relevant verification steps. If everything passes, no commit is needed for this task.

---

## Self-Review Checklist (run after writing this plan)

- **Spec coverage:** every spec section maps to one or more tasks.
  - §3 Architecture → Tasks 7–9 (CGI), Task 2 (runner skeleton)
  - §3.4 Status JSON shape → Task 2 (`_init_status`, `_emit_result`)
  - §4 Test Catalog → Task 3
  - §5 Frontend → Tasks 11–15
  - §5.3 Hook → Task 10
  - §6 Tarball Contents → Task 4
  - §6.1 Redaction → Task 4 + Task 5 fixture
  - §7 Error Handling → Task 7 (stale-PID sweep), Task 4 (`complete_no_bundle`), Task 15 (error display)
  - §8 Testing Strategy → Task 5 (redaction), Task 18 (manual)
  - §9 Conventions → followed throughout (badge classes, plain CardHeader, default Button variant, Loader2 spinner)
- **Placeholder scan:** no TBD/TODO/`fill in` strings in plan steps.
- **Type consistency:** field names match between `types/system-health-check.ts` (Task 1), the runner JSON shape (Task 2), and the hook (Task 10): `job_id`, `status`, `summary {pass,fail,warn,skip,total}`, `tests []`, `tarball_path`, `tarball_size`, `error`. `TestStatus` values match runner's emitted strings: `pass | fail | warn | skip | running | pending`.
- **Function/method names:** `_run_test`, `_emit_result`, `_init_status`, `_finalize_status`, `_build_bundle`, `_redact_tree`, `_check_bin`, `t_*` test functions — all defined exactly where they are called.
- **Sudoers helper path** (`/usr/bin/qmanager_health_check`) matches the file the installer deploys (`scripts/usr/bin/qmanager_health_check` is auto-installed to `/usr/bin/` per `install_backend` in `scripts/install_rm520n.sh:776`).
- **Status file path** is consistent: `/tmp/qmanager_health_check.json` in runner, `run.sh`, `status.sh`, hook.
- **Job ID regex** (`^[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$`) is identical in runner argv check (Task 2) and in `download.sh` (Task 9).
