# System Health Check — Design Spec

**Date:** 2026-05-04
**Branch:** `dev-rm520`
**Status:** Approved (pending implementation plan)

## 1. Purpose

Provide a single page under System Settings that runs a comprehensive battery of health and functional checks against all services QManager features depend on, then offers a downloadable diagnostic bundle for offline review or support handoff.

Primary goals:
- Surface broken/missing components quickly when a feature does not work as expected.
- Prepare for supporting additional Quectel modem variants with similar architecture by giving us (and field techs) one tool that captures everything needed to debug a fresh deployment.
- Keep the experience aligned with the existing QManager design language — no new visual patterns.

## 2. Scope

**In scope:**
- A new page at `app/system-settings/system-health-check/page.tsx`
- A new card on `app/system-settings/page.tsx` linking to the page
- Backend CGI under `scripts/www/cgi-bin/quecmanager/system/health-check/` (`run.sh`, `status.sh`, `download.sh`)
- A privileged runner helper at `scripts/usr/lib/qmanager/qmanager_health_check` (sudoers-whitelisted)
- React Query hook `hooks/use-system-health-check.ts`
- Tarball bundling with redaction of secrets

**Out of scope:**
- Auto-remediation (the page reports; it does not "fix" anything)
- Scheduled/automatic background runs
- Historical run archive (only the most recent run is retained)
- Email/SMS delivery of the bundle
- Integrating diagnostics into the OTA updater pre-flight

## 3. Architecture

### 3.1 Backend layout

```
scripts/www/cgi-bin/quecmanager/system/health-check/
├── run.sh         # POST: spawn runner, return job_id (idempotent)
├── status.sh      # GET: return status JSON; ?test_id=… returns single test output
└── download.sh    # GET ?job_id=…: stream tarball with attachment headers

scripts/usr/lib/qmanager/
└── qmanager_health_check    # privileged runner (called via sudo -n from run.sh)
```

### 3.2 Job lifecycle

1. User clicks **Run Diagnostics** → `POST run.sh`
2. `run.sh` reads `/tmp/qmanager_health_check.json`. If `status === "running"` and `pid_alive` returns true, it returns the existing `job_id`. Otherwise it creates a new `job_id` (`<UTC-timestamp>-<random4>`), spawns the runner via `setsid sudo -n qmanager_health_check <job_id> &` and returns `{ job_id, started_at }`.
3. Runner initializes status JSON with all tests in `pending`, sets `status: "running"`, then iterates tests. After each test it atomically rewrites the JSON (`.tmp` + `mv`).
4. Runner builds the tarball at `/tmp/qmanager_health_check_<job_id>.tar.gz`, sets `status: "complete"`, populates `tarball_path` and `tarball_size`.
5. Frontend polls `status.sh` every 500 ms while `status === "running"`, stops on `complete` or `error`.
6. **Download** triggers `GET download.sh?job_id=<id>`; the script validates `job_id` against `^[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$`, resolves the tarball under `/tmp/`, and streams it with `Content-Disposition: attachment`.

### 3.3 Concurrency & cleanup

- Single `flock -x -n` on `/tmp/qmanager_health_check.lock` prevents two simultaneous runs.
- AT-related tests acquire the existing shared `/tmp/qmanager_at.lock` via the same `flock_wait()` helper used by `qcmd`/`sms_tool`.
- At the start of each new run, the runner deletes any `qmanager_health_check_*` job dirs/tarballs in `/tmp/` older than 1 hour.
- A stale-job sweep at the start of `run.sh` flips a `running` job whose PID is dead to `status: "error"` with `error: "runner exited unexpectedly"`.

### 3.4 Status JSON shape

Polled response (slim — no raw outputs):

```json
{
  "job_id": "20260504-153012-a4f9",
  "status": "running" | "complete" | "complete_no_bundle" | "error",
  "started_at": 1714838412,
  "finished_at": null,
  "pid": 12345,
  "summary": { "pass": 0, "fail": 0, "warn": 0, "skip": 0, "total": 38 },
  "tests": [
    {
      "id": "bin.atcli",
      "category": "binaries",
      "label": "atcli_smd11 present",
      "status": "pass",
      "duration_ms": 12,
      "detail": "v1.0.3"
    }
  ],
  "tarball_path": "/tmp/qmanager_health_check_<job_id>.tar.gz",
  "tarball_size": 24576,
  "error": null
}
```

Per-test raw output (stdout+stderr) is written to `/tmp/qmanager_health_check_<job_id>/tests/<test_id>.txt`. The polled JSON only carries a short `detail` string. The frontend can fetch a single test's raw output snippet via `status.sh?job_id=<id>&test_id=<id>` (returns last 4 KB) when the user expands a failing row.

## 4. Test Catalog

Tests are grouped by category. Each test produces `id`, `category`, `label`, `status` (`pending` | `running` | `pass` | `fail` | `warn` | `skip`), `duration_ms`, `detail`, and writes raw output to its per-test file.

### 4.1 Binaries & Versions
- `atcli_smd11` present + version
- `sms_tool` present + version
- `qcmd` wrapper present
- `jq`, `curl`, `openssl`, `xmlstarlet` present
- `speedtest` present (warn if missing)
- `tailscale` present (skip if Tailscale not installed)
- `msmtp` present (skip if email alerts not configured)
- `ttyd` present (warn if missing)

### 4.2 Filesystem & Permissions
- `/dev/smd11` exists, mode `660`, owner `root:dialout`
- `www-data` user exists and is in `dialout` group
- `/usrdata/qmanager/` traversable by www-data (mode 755)
- Rootfs writability check (`mount` flag)
- `/tmp` writable by www-data

### 4.3 AT Transport (functional)
- `qcmd "AT"` returns `OK`
- `qcmd "AT+CGMI"` returns manufacturer
- `qcmd "AT+CGMM"` returns model
- `qcmd "AT+CGSN"` returns IMEI (length-validated; masked in `report.txt`)
- `qcmd "AT+CFUN?"` reports radio state
- Lock contention: two back-to-back `qcmd` calls succeed in serialized order

### 4.4 SMS Subsystem (functional, no actual send)
- `sms_tool -j recv` returns valid JSON
- `flock` on `/tmp/qmanager_at.lock` works
- SIM presence: `qcmd "AT+CPIN?"` returns `READY`

### 4.5 Sudoers
- `sudo -n -l` lists qmanager helpers visible to www-data
- Rule for at least one expected helper exists

### 4.6 Systemd Services
For each unit (`qmanager-firewall`, `qmanager-poller`, `qmanager-console`, `qmanager-setup`, `lighttpd`, plus optional `tailscaled`, `qmanager-tailscale-watchdog`):
- Unit file exists (`systemctl list-unit-files`)
- Enabled (symlink in `multi-user.target.wants`)
- Active state recorded

### 4.7 Network
- DNS resolves (`nslookup install.speedtest.net`)
- IPv4 reachability (`ping -c 1 -W 2 1.1.1.1`)
- Modem data interface up (`rmnet+` exists with IP)
- Lighttpd listening on 80/443
- Firewall snapshot (`iptables -L INPUT -n`)

### 4.8 Configuration sanity
- `/etc/qmanager/` exists; key configs valid JSON (`sms_alerts.json`, `email_alerts.json` if present)
- Poller cache `/tmp/qmanager_poller_cache.json` exists, mtime within last 60 s
- lighttpd CGI PATH includes `/opt/bin`

Total: ~35–40 tests.

## 5. Frontend

### 5.1 Route & navigation
- New page: `app/system-settings/system-health-check/page.tsx`
- New card on `app/system-settings/page.tsx` linking to the page, matching the visual pattern of the existing Logs / Software Update / AT Terminal / Web Console cards
- Title: **System Health Check**
- Description: short sentence explaining purpose

### 5.2 Layout

**Summary Card (top)** — plain `CardHeader` with `CardTitle` "System Health Check" + `CardDescription`. Body shows:
- Counts using outline status badges per CLAUDE.md (`bg-success/15 text-success`, etc.): `X passed · Y failed · Z warnings · N skipped`
- Right side: `<Button>` "Run Diagnostics" (default variant). While running it shows `Loader2Icon` + "Running…"
- When complete: `<Button>` "Download Bundle" (default variant) appears
- Relative timestamp: "Last run: 2 minutes ago"

**Category Cards (below)** — one card per category. Plain `CardHeader` (no icons) with `CardTitle` (category name) + `CardDescription` (short purpose).
- Body: list of test rows. Each row shows the label on the left and an outline status badge on the right with the appropriate semantic class + lucide icon (`CheckCircle2Icon`, `XCircleIcon`, `TriangleAlertIcon`, `MinusCircleIcon`, `Loader2Icon`).
- Failed/warned rows are expandable; expansion fetches the per-test snippet via `status.sh?test_id=…` and renders it in a `<pre>` block. Pass rows are not expandable.
- Fail-first ordering across cards: any category with at least one failure sorts above all-passing categories.

**Empty state** — central card with icon + "No diagnostics run yet" + the Run button. No charts, no fill bars.

**Mobile** — cards stack full-width; rows allow status badge to wrap below label.

### 5.3 Hook
`hooks/use-system-health-check.ts` exposes:
- `useRunHealthCheck()` — React Query mutation calling `run.sh`
- `useHealthCheckStatus()` — React Query query polling `status.sh` (refetchInterval 500 ms while `status === "running"`, `false` otherwise)
- `useHealthCheckTestOutput(testId)` — lazy query for per-test raw output
- `downloadHealthCheckBundle(jobId)` — helper that triggers a browser download from `download.sh`

## 6. Tarball Contents

```
qmanager-health-check-<timestamp>.tar.gz
├── report.txt                # human-readable summary, sectioned by category
├── report.json               # full status JSON + per-test outputs inlined
├── system-info.txt           # uname -a, /etc/os-release, uptime, free, df, mount, ip a
├── services/
│   ├── qmanager-poller.txt   # systemctl status + last 50 journal lines
│   ├── qmanager-firewall.txt
│   ├── lighttpd.txt
│   └── …
├── config/
│   ├── lighttpd.conf         # sanitized
│   ├── sudoers-qmanager      # /etc/sudoers.d/qmanager
│   ├── sms_alerts.json
│   └── email_alerts.json     # msmtprc password REDACTED
├── logs/
│   ├── qmanager-poller.log   # last 200 lines
│   └── lighttpd-error.log    # last 200 lines, Cookie/Authorization redacted
├── tests/
│   └── <test_id>.txt         # raw stdout+stderr per test
└── poller-cache.json         # snapshot of /tmp/qmanager_poller_cache.json
```

### 6.1 Redaction policy

Applied during bundling:

| Item | Action |
| ---- | ------ |
| `password` lines in `msmtprc` | replaced with `password REDACTED` |
| Tailscale auth keys (`tskey-…`) in any captured output | replaced with `tskey-… REDACTED` |
| `Cookie:` / `Authorization:` headers in log tails | header name kept, value replaced with `REDACTED` |
| `/etc/shadow`, SSH host keys, SSH user keys, TLS private keys | never read, never bundled |
| IMEI in `report.txt` | last 6 digits masked (`xxxxxx`) |
| IMEI in `report.json` | full IMEI retained (user opted in by downloading) |

Sudoers and systemd unit files are public-by-design and bundled as-is.

## 7. Error Handling

- Runner crashes mid-job → status JSON's last state is preserved; the next `run.sh` call detects the dead PID and flips `status` to `error`.
- Tarball build fails → `status: "complete_no_bundle"`, frontend replaces Download button with "Bundle generation failed: <reason>".
- Individual test crashes → captured as `fail` with `detail: "test runner error"`, full stderr in the per-test file.
- CGI permission errors / sudoers misconfig (the very thing we're testing) → `run.sh` returns HTTP 500 with `{ error: "<reason>" }`; the frontend renders an error card with guidance.

## 8. Testing Strategy

- **Manual runtime test on RM520N-GL hardware** is the primary validation: full end-to-end run, observe each test row, confirm tarball contents and redaction.
- **Frontend type check**: `bunx tsc --noEmit`.
- **Per-test functions** in `qmanager_health_check` are small, single-purpose, each emits via a shared `_emit_result` helper — easy to inspect with `bash -x`.
- **Redaction fixture**: `scripts/test/health-check-redaction.sh` runs the redaction filter against synthetic input containing each secret type and greps for leakage. Manual run only, not CI.

## 9. Conventions Adherence

This feature follows the design conventions documented in `CLAUDE.md`:
- Status badges use `variant="outline"` with the documented semantic classes and `size-3` icons.
- `CardHeader` is plain `CardTitle` + `CardDescription` without icons.
- Primary buttons (Run Diagnostics, Download Bundle) use the default variant.
- Step progress uses `Loader2Icon` + dot indicators; no fill bars.
- Light/dark themes via existing OKLCH tokens; no one-off styles.

## 10. Open Questions

None at design time. Implementation will surface concrete details (exact systemctl unit list, exact sudoers helpers list) by reading the current source tree at plan time.
