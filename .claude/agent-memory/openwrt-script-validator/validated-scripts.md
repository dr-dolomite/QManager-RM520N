---
name: validated-scripts
description: Scripts that have been audited for OpenWRT/BusyBox compatibility and their status
type: project
---

## Validated Scripts

### 2026-03-21 — OTA Update Scripts (update.sh, qmanager_update, install.sh)

| Script | Status | LF | Bashisms | Issues Fixed |
| --- | --- | --- | --- | --- |
| `scripts/www/cgi-bin/quecmanager/system/update.sh` | PASS | OK | 0 | none |
| `scripts/usr/bin/qmanager_update` | PASS | OK | 0 | none |
| `scripts/install.sh` | PASS (after fix) | OK | 0 | glob chmod under `set -e` |

#### Details

- `update.sh`: `// empty` on tag_name/body/browser_download_url — safe (string fields, never boolean). `--argjson prerelease` receives UCI value "1"/"0" — valid JSON integers. Double-fork spawn pattern correct (line 298/313). `semver_compare()` `\>` / `\<` in `[ ]` — CONFIRMED NOT valid ash (BusyBox `[` does not support string ordering operators); fixed 2026-03-22 with sort+head pattern.
- `qmanager_update`: No bashisms. PID file write (`echo $$ > "$PID_FILE"`) — safe, `$$` is always a plain integer. `trap - EXIT INT TERM` before final `reboot` — valid POSIX trap reset.
- `install.sh`: Bug fixed — line 373: `chmod 644 "$LIB_DIR"/*.sh` glob fails with non-zero exit when no `.sh` files present, killing installer under `set -e`. Replaced with `find "$LIB_DIR" -maxdepth 1 -name "*.sh" -exec chmod 644 {} \;`. `pidof` (line 525) is a BusyBox applet — safe.

Total issues: 1 fixed (glob chmod in install.sh)

---

### 2026-03-22 — OTA Update Scripts (re-audit + build.sh + installer re-audit)

| Script | Status | LF | Issues Fixed |
| --- | --- | --- | --- |
| `scripts/www/cgi-bin/quecmanager/system/update.sh` | PASS (after fix) | OK | `\>` / `\<` in `[ ]`; `$reset_ts` empty guard |
| `scripts/usr/bin/qmanager_update` | PASS | OK | none |
| `build.sh` (dev machine, bash) | PASS (after fix) | OK | Operator precedence bug in copy-exclusion loop |
| `qmanager-installer.sh` | PASS | OK | none (operational warning: hardcoded SHA-256) |

#### Details

- `update.sh` lines 114-115: `[ "$a_pre" \> "$b_pre" ]` — BusyBox `[` does NOT support `\>` / `\<` string ordering operators. Fixed with `sort | head -1` lexical comparison.
- `update.sh` line 181: `$reset_ts` from HTTP header sed could be empty; added `[ -n "$reset_ts" ]` guard before `-gt` comparison.
- `build.sh` line 34: `[ A ] || [ B ] && continue` parsed as `[ A ] || ([ B ] && continue)` — install.sh was never actually excluded from the scripts/* copy. Fixed with `case "$name" in install.sh|uninstall.sh) continue ;; esac`.
- `qmanager-installer.sh`: EXPECTED_SHA256 hardcoded — will be stale after each new build. No automated sync mechanism. Operational concern, not a shell bug.
- `qmanager_update`: Clean — no bashisms, correct trap/cleanup/cd patterns.

---

### 2026-03-21 — qmanager-installer.sh (standalone installer)

| Script                  | Status           | LF | Bashisms | Issues Fixed              |
|-------------------------|------------------|----|----------|---------------------------|
| `qmanager-installer.sh` | PASS (after fix) | OK | 0        | `ls -lh` -> `du -k` (x2) |

#### Details

- Lines 128, 342: `ls -lh "$ARCHIVE_PATH" | awk '{print $5}'` — BusyBox `ls` does not support `-h`. Replaced with `du -k "$ARCHIVE_PATH" | awk '{print $1 "K"}'`.
- Glob fallthrough pattern on lines 236/244 correctly guarded with `[ -e ]` / `[ -f ]`.
- Color variables correctly collapsed to empty strings when not a terminal (line 45).
- `clear 2>/dev/null || true` is guarded — safe even if `clear` unavailable.
- `command -v`, `killall`, `crontab -l | grep -v | crontab -`, `uci`, `tar xzf -C` all safe.
- `local` usage: one variable per declaration throughout — no multi-var `local` violations.

Total issues: 1 fixed (`ls -lh` used twice)

---

### 2026-03-16 — Tailscale CGI Endpoint

| Script                                     | Status           | LF               | Bashisms | jq Safety | Issues Fixed          |
|--------------------------------------------|------------------|------------------|----------|-----------|-----------------------|
| `scripts/cgi/quecmanager/vpn/tailscale.sh` | PASS (after fix) | Fixed (was CRLF) | 0        | All safe  | `pgrep -x` → `pidof` |

#### Details

- CRLF line endings present on creation (Windows dev env) — stripped immediately.
- Line 42: `pgrep -x tailscaled` → `pidof tailscaled`. BusyBox `pgrep` does not reliably support `-x` (exact match) on all OpenWRT targets; `pidof` is a BusyBox applet with exact-match by design.
- Line 390: `set_boot_enabled` uses correct safe jq boolean pattern: `if . == null then empty else tostring end`. No `// empty` trap.
- `jq // "fallback"` on string-only fields (`.BackendState`, `.AuthURL`, etc.) is safe — these are never booleans.
- `// false` and `// 0` defaults in peer/self jq constructs: harmless (default equals possible value; no misrepresentation).
- `timeout` command guarded with `command -v timeout` — correct degradation pattern.
- Background `tailscale up` via `( ... ) &` inside CGI: single-fork is acceptable since CGI exits and child is reparented to init.
- `killall` (line 378): BusyBox applet — confirmed safe.

Total issues: 1 fixed (CRLF + pgrep -x)

### 2026-03-15 — Email Alerts Feature (Final Audit: 3 scripts, all PASS)

| Script | Status | LF | Multi-var | jq Safety | Issues |
|--------|--------|----|----|---|--------|
| `scripts/usr/lib/qmanager/email_alerts.sh` | **✅ PASS** | ✓ | ✓ Split (118–120) | ✓ Safe null-handling | 0 |
| `scripts/cgi/quecmanager/monitoring/email_alerts.sh` | **✅ PASS** | ✓ | N/A | ✓ Safe `// empty` on strings | 0 |
| `scripts/debug_email_alerts.sh` | **✅ PASS** | ✓ | N/A | ✓ N/A | 0 |

**Library (email_alerts.sh) Details:**
- Lines 118–120: ONE VAR PER LINE (BusyBox ash requirement) ✓
- Lines 163–185: Retry logic (while loop, 3 attempts, 10s sleep) — all POSIX, clean exit flow ✓
- Line 232: Error capture `2>/tmp/msmtp_last_err.log` + line 239 safe retrieval via `local err_detail` ✓
- jq: `.enabled | if . == null then "false"` (explicit null→false, safe) ✓
- HTML heredocs: Variables properly interpolated in email templates ✓

**CGI Endpoint Details:**
- Line 133: `tls_trust_file /etc/ssl/certs/ca-certificates.crt` present (Gmail STARTTLS requirement) ✓
- Line 87: `jq '.app_password // empty'` safe (empty handles null in password context; password is string-only) ✓
- Line 96–105: Threshold validation loop (1–60 range, numeric guard) — clean POSIX case/numeric check ✓

**Debug Script Details:**
- Comprehensive pre-flight (library, config, processes, jq fix check) ✓
- CFUN=0/1 simulation with state sampling ✓
- Diagnostic logic (jq bug detection, LONG_FLAG check, msmtp log diff) ✓
- All read-only except `touch` for test flag ✓

**Total issues: 0 (all severity levels)**
**Recommendation: Ready to commit**

### 2026-03-15 — Full daemon audit (qmanager_ping + qmanager_poller + email_alerts.sh)

| Script | Status | Issues Found | Fixed? |
|--------|--------|-------------|--------|
| `scripts/usr/bin/qmanager_ping` | PASS | No issues — clean POSIX sh, LF, one-var-per-local | N/A |
| `scripts/usr/bin/qmanager_poller` | PASS (after fix) | 6× multi-var `local` (C); `jq // empty` on `.timestamp` (W) | Yes — split to one per line; replaced with `if . == null then empty` |
| `scripts/usr/lib/qmanager/email_alerts.sh` | PASS (after fix) | `local trigger status recipient` multi-var in `_ea_log_event()` (C) | Yes — split to one per line |

Fixed lines in `qmanager_poller`:
- `local cur_idle cur_total` → split (update_proc_metrics)
- `local diff_idle diff_total` → split (update_proc_metrics)
- `local mem_total mem_available` → split (update_proc_metrics)
- `local lte_mimo_result nr_mimo_result` → split ×2 (collect_boot_data, poll_tier2)
- `local ping_ts now age` → split; `// empty` → `if . == null then empty else tostring end` (read_ping_data)
