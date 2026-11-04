# Debug Report (System Health Check → Debug report card)

> **Applies to:** RM520N-GL (SDX65) · added 2026-11-01 (P6, RM551E v0.1.34 parity) · not yet verified on hardware
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Card: `components/system-settings/diagnostics/diagnostics-card.tsx` · namespace `public/locales/*/system-health-check.json`, `diagnostics.*`

The debug report is a single text file a user can download and attach to a GitHub issue. It collects versions, memory and disk, the state of every `qmanager*` systemd unit, network routes, a filtered tail of `/tmp/qmanager.log` and masked copies of the runtime JSON files. It exists because journald is masked to `/dev/null` on this device, so there is no system log to ask for; the report gathers the few signals that do survive. The generator is an RM520N-native rewrite of RM551E's OpenWRT tool, not a port: it reads systemd, `/tmp` and Entware paths, never UCI or `logread`.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| UI | Debug report card at the foot of `/system-settings/system-health-check`, rendered in every page state |
| Hook | `hooks/use-diagnostics.ts` (`useDiagnostics`) |
| Types | `types/diagnostics.ts` |
| Endpoint | `POST /cgi-bin/quecmanager/system/diagnostics.sh` with `{"action":"capture"}` |
| Generator | `/usr/bin/qmanager_debug_report` (source `scripts/usr/bin/qmanager_debug_report`) |
| Runs as | `www-data` — no sudo, no sudoers line |
| Output | `/tmp/qmanager_debug_<epoch>.txt`, mode `0600` (`umask 077`) |
| Kept | the newest 2 reports; older ones are deleted on each run |
| Size cap | `MAX_BYTES=204800` (200 KB) |
| Per-command bound | `timeout 4` when `timeout` exists |

Run it by hand on the device to see exactly what the UI would download:

```sh
sudo -n -u www-data /usr/bin/qmanager_debug_report
```

The last line of stdout is the report's path.

---

## Endpoint contract

Success:

```json
{ "success": true, "filename": "/tmp/qmanager_debug_1730430000.txt", "content": "===== QManager Debug Report =====\n..." }
```

`filename` is the full device path. The hook keeps only the basename for the download name (`qmanager_debug_1730430000.txt`), falling back to `qmanager-debug-report.txt`. `content` is embedded with `jq --rawfile`, and the browser saves it as a `text/plain` Blob.

| Error | When |
| --- | --- |
| `report_tool_missing` | `/usr/bin/qmanager_debug_report` is absent or not executable |
| `capture_failed` | the tool's last non-empty stdout line is empty or not a file |
| `unknown_action` | POST with any `action` other than `capture` |
| `method_not_allowed` | any method other than POST |

The CGI takes the **last non-empty stdout line** as the path. Anything the generator prints must go before that line, or the capture fails.

---

## What is in the report

Sections are an allowlist, in this order. Nothing outside it is read.

| Section | Source |
| --- | --- |
| `qmanager_version`, `quectel_project`, `kernel` | `/etc/qmanager/VERSION`, `/etc/quectel-project-version`, `uname -a` |
| `uptime`, `memory`, `df` | `uptime`, `free`, `df -k` |
| `systemd_qmanager_units` | `systemctl show` of every `qmanager*` unit: `ActiveState`, `SubState`, `NRestarts`, `Result` |
| `dmesg_tail_100` | `dmesg \| tail -n 100`, or `restricted` (below) |
| `ip_addr`, `ip_route` | `ip -br addr`, `ip route` |
| `iptables_rule_counts` | rule **counts** for filter, nat and mangle, never the rules; or `restricted` |
| `qmanager_log_tail_200` | `/tmp/qmanager.log`, filtered (below) |
| `runtime_status.json`, `runtime_ping.json`, `runtime_qmi.json` | `/tmp/qmanager_status.json`, `/tmp/qmanager_ping.json`, `/tmp/qmanager_qmi.json`, masked (below); a missing file is skipped |

It sends no AT command (no `qcmd`), reads no secret store, and restarts nothing.

### `restricted` sections are expected

The generator runs as `www-data`, so two sections usually read `restricted` on a stock device, and that is not a fault:

- **dmesg** — `kernel.dmesg_restrict=1`, so a non-root user cannot read the kernel ring buffer. The generator checks `/proc/sys/kernel/dmesg_restrict` and its own uid before calling `dmesg`.
- **iptables** — reading rules needs root. A non-zero exit from `iptables -S` prints `restricted`.

Running the tool as root fills both sections. Do not add a sudoers line to make the UI do that: the report is downloaded into a browser, and root-only data has no business there.

---

## Masking

Three layers, because the report is meant to be pasted into a public issue.

1. **JSON identifiers.** A jq `walk` replaces the value of any key named `imei`, `imsi`, `iccid`, `phone_number`, `msisdn`, `imeisv`, `ippt_mac` or `matching_profile_name` (case-insensitive) with `"[masked]"`, at any depth. It also drops `connectivity.latency_history`.
2. **Log-line filter.** Of the last 1000 log lines, any line matching `sms|email|smtp|discord|password|passwd|token|session|cookie|secret|otp` (case-insensitive) is dropped, then the last 200 survivors are kept.
3. **Value masks on what is left.** The value after `ICCID`, `IMSI` or `IMEI` becomes `[masked]`, and any run of 10 or more digits becomes `[num]`.

Every section is also passed through `tr -cd '\11\12\40-\176'`: only TAB, LF and printable ASCII survive. That keeps `jq --rawfile` safe, and it also means any UTF-8 text (a carrier name in Chinese, say) is stripped to its ASCII parts.

> ⚠️ WARNING: the masks are key- and pattern-based. A new identifier field in `status.json` under a new key name, or a log line that prints an IMSI without the word `IMSI` and in fewer than 10 digits, goes into the report unmasked. Add the key to `MASK_JQ` when a poller field carries a subscriber identifier.

---

## The write and the cap

- The report is built in `<OUT>.tmp.<pid>` and renamed over `OUT` only when complete, so a reader never sees a half-written file. A `trap` deletes the temp files on exit.
- Over 200 KB, the middle is cut: the first 250 and last 250 **lines** are kept with a `[TRIMMED …]` marker. The cap triggers the cut; it does not guarantee the result is under 200 KB if the lines are very long.
- Pruning lists `/tmp/qmanager_debug_*.txt` by mtime and deletes all but the newest 2. It only matches its own name pattern.

---

## UI behaviour

The card needs no health-check run, so it renders in every state of the page. It is a fixed sibling after the page's conditional blocks, so a state change does not remount it. Success toasts `diagnostics.toast_success`; failure toasts `diagnostics.toast_failed` with the resolved reason as the description, and keeps that reason in a persistent notice on the card.

---

## Related

- [platform-matrix.md](platform-matrix.md) — why journald gives nothing on this device, and what differs on the RG501Q-EU
- [logs.md](logs.md) — the Logs page, which reads the same `/tmp/qmanager.log` unfiltered for a signed-in user
- [tmp-file-ownership.md](tmp-file-ownership.md) — `/tmp` ownership rules for files written by `www-data`
