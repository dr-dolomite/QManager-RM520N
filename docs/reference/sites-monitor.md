# Sites Monitor

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10-11 (serial `61368cd2`)
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

The Sites monitor measures how long it takes to open a TCP connection to each of a list of websites over the cellular link, every few minutes, and keeps a history of up to 90 days — the per-site latency view UniFi and WiFiman show. It exists because the one-host ICMP verdict in [Connection Quality](connection-quality.md) answers "is there internet?", not "is YouTube slow right now?". It is a separate root daemon, `qmanager_sites`, that never touches the modem serial port and does **not** feed the connectivity verdict, events or alerts. Its page is the **Sites** card on `/monitoring/latency`; the frontend's invariants (polling cadence, the range average, brand marks) are in [latency-monitor.md](latency-monitor.md).

## Quick Reference

| Item | Value |
|------|-------|
| Daemon | `/usr/bin/qmanager_sites` (source: `scripts/usr/bin/qmanager_sites`), `#!/bin/bash` for 64-bit arithmetic |
| systemd unit | `qmanager-sites.service` — `Restart=on-failure`, `StartLimitIntervalSec=3600` / `StartLimitBurst=5` in `[Unit]`; boot-enabled by the installer's `qmanager-*.service` wants-symlink loop and started in `start_services` |
| CGI | `GET/POST /cgi-bin/quecmanager/monitoring/sites.sh` |
| Config | `/etc/qmanager/sites.json` (written by the CGI as www-data; validated by the daemon as untrusted input). Absent = defaults |
| Latest sweep | `/tmp/qmanager_sites.json` (root, atomic) |
| Raw samples | `/tmp/qmanager_sites_raw.ndjson` (root, last 24 h) |
| Rollup cursor | `/tmp/qmanager_sites_flushed` (root, atomic; newest raw `ts` already rolled up) |
| Sweep marker | `/tmp/qmanager_sites_checking` (root; exists while a sweep runs) |
| PID file | `/tmp/qmanager_sites.pid` (root, atomic) |
| Check-now flag | `/tmp/qmanager_sites_now` (created by www-data; root only tests and removes it) |
| Live lease | `/tmp/qmanager_sites_live` (one epoch, written by www-data on each `range=now` GET while enabled; root only reads it) — see [Live mode](#live-mode) |
| Live samples | `/tmp/qmanager_sites_live.json` (root, atomic; ~2 s HTTP samples while leased; never history) |
| History | `/usrdata/qmanager/sites/YYYY-MM-DD.jsonl` — hourly rows, one file per **UTC** day, append-only; 90 days and 4 MB cap |
| Defaults | 13 sites: `google.com facebook.com tiktok.com youtube.com roblox.com spotify.com x.com cellmapper.net reddit.com github.com discord.com instagram.com messenger.com`; `interval_sec` 300 |

## What a sample measures

Each site is probed with:

```sh
curl -s -I -o /dev/null --connect-timeout 5 --max-time 6 \
     -w '%{time_namelookup} %{time_connect}' -- "https://<host>"
```

`ms = (time_connect − time_namelookup) × 1000`, rounded to 0.1 ms.

- **Why subtract `time_namelookup`.** `time_connect` is cumulative from the start of the transfer, so it includes DNS. The difference is the TCP handshake alone, which is the per-site number worth comparing; resolver time is measured separately as `connectivity.dns_lookup_ms`.
- **Why `curl -I` and not `--connect-only`.** The device's curl (8.12.0 on RM520N-GL) has no `--connect-only` CLI option. A `HEAD` request keeps each exchange to a few KB.
- **A sample counts only when curl exits 0.** A host that completes the TCP handshake but fails TLS or does not answer the `HEAD` within `--max-time 6` reads as no answer (`ms: null`). That is deliberate: it is "the site did not respond", not "the handshake was slow".
- An IPv4-literal host gets `-k`, because its certificate cannot match the address.
- `--` precedes the URL so a configured host can never be read as a curl option.
- All sites run as **parallel background jobs**. Measured on RM520N-GL: a 13-site sweep takes 5–6 s (about 19 s serially); 12 of 13 answered, `cellmapper.net` being flaky from that link.

### The gateway entry

When the default route has a real next hop (`ip route show default` contains `via`) on a LAN-style interface, the sweep adds one `kind: "gateway"` entry, timed with `ping -c1 -W2`. It is **omitted** when the default route's device is `rmnet*`, `ppp*`, `wwan*` or `usb*`. On the RM520N-GL the default route is the point-to-point `rmnet` hop, which does not answer ICMP, so the entry would be a permanent "no answer".

## Ownership and the `/tmp` rules

`/tmp` is sticky with `fs.protected_regular=1`: root cannot `O_CREAT`-write a file another user created there (see [tmp-file-ownership.md](tmp-file-ownership.md)). The daemon therefore:

- writes every file it owns by `mktemp` + `chmod 0644` + `mv` (`atomic_put`), never by redirecting onto a fixed name;
- runs `own_or_rm` on each fixed name before use: a file or symlink it does not own is deleted (root may unlink in a sticky directory), then recreated as root. This covers `qmanager_sites.json`, `_raw.ndjson`, `_flushed`, `_live.json` and the PID file;
- treats a PID file it does not own as untrusted **before** the singleton check. Otherwise a www-data file holding a live PID (for example `1`) would make every start exit 1 and trip `start-limit-hit` after five tries.

Two files cross UIDs, both one-way from www-data to root: the check-now flag below and the [live lease](#live-mode). The flag's protocol:

| Step | Who | Action |
|------|-----|--------|
| 1 | www-data (CGI) | `: > /tmp/qmanager_sites_now` |
| 2 | root (daemon) | tests `-e` every 5 s while waiting; never writes it |
| 3 | root (daemon) | `rm -f` it, then sweeps |

A flag only cuts the wait if at least 10 s (`MIN_FLAG_GAP`) have passed since the last sweep ended, so a spammed button cannot sweep faster than that. A `save` with `enabled: true` raises the same flag.

## Timing and the wall-clock gate

- **Boot:** the first sweep waits until `/proc/uptime ≥ 60 s` (`BOOT_SETTLE`), past the ~24 s clock step and the ~30 s `/opt` (jq) mount. If jq is still unusable, `load_config` retries every 15 s.
- **Cadence:** the next sweep is `interval_sec` after the previous one **ended**, measured on `/proc/uptime`. `interval_sec` is clamped to 60–3600.
- **Disabled** (`"enabled": false`): the daemon stays running and re-reads the config every 30 s; it does not sweep.
- **Wall-clock gate:** the device boots at Jan 1970 ([scheduled-timers.md](scheduled-timers.md)). Below epoch `1700000000` (`SANE_EPOCH`) a sweep still runs and still publishes `/tmp/qmanager_sites.json`, but with `checked_at` and `next_check_at` `null`, and **nothing** is appended to the raw file or the rollups. History is never bucketed under a 1970 timestamp. The CGI applies the same gate: below it, GET reads no history files at all.
- **SIGTERM** kills in-flight probes and flushes the pending hour into the rollups (when the clock is sane) before exiting; `TimeoutStopSec=10` covers it.

## Live mode

The Sites card's **Now** range shows a figure that refreshes about every 2 s. The browser drives it through a lease: while someone has Now open in a visible tab, the daemon probes every configured site about every 2 s between sweeps, and stops on its own when nobody is watching.

| Step | Who | Action |
|------|-----|--------|
| 1 | www-data (CGI) | each `GET ?range=now` writes the current epoch to `/tmp/qmanager_sites_live` — only when the saved config has `enabled: true`; a failed write is ignored |
| 2 | root (daemon) | in the wait between sweeps, `live_fresh` reads the lease (digits only, at most 12, not a symlink) and runs a live tick while it is 0–10 s old (`LIVE_LEASE_SEC`); otherwise it naps 5 s (`POLL`) as before |
| 3 | root (daemon) | each tick probes all sites in parallel, publishes `/tmp/qmanager_sites_live.json` with `atomic_put`, then sleeps out the rest of 2 s (`LIVE_TICK`) |
| 4 | www-data (CGI) | a `save` with `enabled: false` runs `rm -f /tmp/qmanager_sites_live` |

- **Root never writes the lease.** It is www-data's file in a `protected_regular` `/tmp`, so the daemon only reads it and trusts nothing but its digits.
- **Disabling has to remove the lease.** The daemon re-reads the config only at the top of each sweep cycle, so without the `rm` in step 4 live ticks would continue for up to 10 s after a disable.
- **Start latency is about 6 s.** The first renewal usually lands during the daemon's 5 s `POLL` nap, so the first live value arrives about one nap plus one tick later. Until then, and whenever the live file is missing or stale, the CGI serves the last sweep's `latest`.
- **Stop latency is about 10 s** after the last renewal: a hidden tab, another range, or leaving the page stops renewals and the lease ages out.
- **No live ticks during a sweep.** Live ticks run only in the wait loop; a due sweep or a check-now flag breaks out of it as before.
- **The gateway entry is not live.** Ticks probe `cfg_hosts` only; in a `range=now` response the gateway keeps the last sweep's `latest`.
- `/tmp/qmanager_sites_live.json` is **kept** when live mode ends; the CGI ignores it once it is more than 6 s old (`LIVE_MAX_AGE` in `sites.sh`). The daemon runs `own_or_rm` on it at start.

### The live probe

```sh
curl -s -I --resolve <host>:80:<cached-ipv4> -o /dev/null --connect-timeout 1.5 --max-time 1.8 \
     -w '%{time_namelookup} %{time_connect} %{remote_ip}' -- "http://<host>/"
```

`ms` is `time_connect − time_namelookup`, rounded to 0.1 ms, as in the sweep. Any HTTP reply with curl exit 0 counts, including a redirect to HTTPS.

- **Plain HTTP on port 80, not HTTPS.** Measured on RM520N-GL `61368cd2` (2026-10-12): an HTTPS `HEAD` costs ~8.8 KB per site, an HTTP `HEAD` on :80 ~1.1 KB (13 of 13 answered). At 13 sites every 2 s the TLS handshake would dominate the traffic.
- **Why still a `HEAD`.** The device's curl has no `--connect-only` and no `telnet://` support, so a bare handshake is not available. bash 3.2 on the device has no `EPOCHREALTIME` and no `declare -A`, so the shell cannot time a connect itself, and the IP cache is a newline-separated `"host ipv4"` string.
- **`--resolve` to a cached IPv4.** Each tick caches the `remote_ip` of every host name that answered and pins the next tick's probe to it, so live ticks do not hit the resolver every 2 s. A host that fails loses its entry and resolves fresh next tick; a change of the site list clears the cache. An IPv4-literal host is never cached.
- `--max-time 1.8` keeps a tick near 2 s with a dead site in the list. The pacing sleep needs fractional `sleep`; if it is unavailable the daemon naps 1 s after each tick instead.

### What live mode never touches

Live samples go **only** to `/tmp/qmanager_sites_live.json`. They never reach the raw file, the rollups, `/tmp/qmanager_sites.json` (`LATEST_FILE`) or the history, so watching Now does not change any 1h–90d figure.

Shape:

```json
{ "at": 1760000000, "results": [ { "host": "google.com", "ms": 41.3, "ok": true } ] }
```

### Cost

Measured on RM520N-GL `61368cd2` (2026-10-12), 13 sites: about **25 MB per hour** of cellular data and about **+25 points** of the single CPU core while live mode runs. Nothing is spent while no browser holds the lease.

## Retention

| Store | Rule |
|-------|------|
| Raw | Rows older than 24 h are trimmed after every sweep |
| Rollups | Completed hours only (raw `ts` below the current hour) are flushed into hourly rows, once each, tracked by `_flushed` |
| Age | Whole day files older than 90 days (by UTC file name) are deleted after each flush |
| Size | While the day files total more than 4 MB, the oldest file is deleted; the newest is never deleted |
| Free space | A flush is skipped when the data directory has under 8 MB free |

## On-disk shapes

`/tmp/qmanager_sites.json`:

```json
{ "checked_at": 1760000000, "interval_sec": 300, "next_check_at": 1760000300, "wan": "cellular",
  "results": [ { "host": "google.com", "kind": "site", "ts": 1760000000, "ms": 41.3, "ok": true } ] }
```

Raw row (`_raw.ndjson`) and rollup row (`YYYY-MM-DD.jsonl`), one JSON object per line:

```json
{"ts":1760000000,"host":"google.com","ms":41.3,"ok":true}
{"ts_hour":1759996800,"host":"google.com","n":12,"ok":11,"min":38.2,"avg":44.9,"max":61.0}
```

In a rollup, `n` is samples taken, `ok` is samples answered, and `min` / `avg` / `max` are over answered samples only (`null` when none answered).

`/etc/qmanager/sites.json` (as the CGI writes it):

```json
{ "enabled": true, "interval_sec": 300, "sites": [ { "host": "youtube.com", "label": "YouTube" } ] }
```

The daemon reads at most 32 sites and drops any host that fails its check (3–253 chars of `[A-Za-z0-9.-]`, at least one dot, no leading/trailing dot or hyphen, no `..`, `.-` or `-.`) or repeats. It uses no jq regex, which the device's jq does not support. A file with no `sites` key gets the defaults; `"sites": []` means no sites.

## CGI contract — `/cgi-bin/quecmanager/monitoring/sites.sh`

### `GET ?range=now|1h|3h|6h|12h|24h|7d|30d|90d`

Default `24h`. Any other value → `{ "success": false, "error": "invalid_range", "detail": "…" }`.

| Range | Bucket | Source |
|-------|--------|--------|
| `now` | — | no history files; `series` is `[]`. Renews the live lease and serves the live sample as `latest` (see [Live mode](#live-mode)) |
| `1h`, `3h`, `6h` | each sample | raw, plus rollups for any hour older than the first raw row |
| `12h` | 10 min | as above |
| `24h` | 20 min | as above |
| `7d` | 2 h | rollups, plus raw rows newer than the rollup cursor (the unflushed hour) |
| `30d` | 8 h | as `7d` |
| `90d` | 1 day | as `7d` |

```json
{
  "success": true,
  "enabled": true,
  "interval_sec": 300,
  "checked_at": 1760000000,
  "next_check_at": 1760000300,
  "checking": false,
  "live_at": null,
  "wans": ["cellular"],
  "summary": { "answered": 12, "total": 13 },
  "sites": [
    { "host": "google.com", "label": "google.com", "kind": "site",
      "latest": { "ts": 1760000000, "ms": 41.3, "ok": true, "wan": "cellular" },
      "series": [ { "ts": 1759998000, "ms": 43.1, "min": 38.2, "max": 61.0, "n": 4, "ok": 4 } ] }
  ]
}
```

- `sites` follows the last sweep's order (the gateway entry first, when there was one), then any configured site that sweep did not include, with `latest: null`. A host the last sweep probed but the current config no longer lists is dropped.
- `series[].ms` is the mean of **answered** samples in the bucket (`null` when none answered); `n` and `ok` let a chart show loss.
- `checking` is `true` while a sweep runs or a check-now flag is pending. `next_check_at` is `null` while the monitor is disabled.
- `live_at` is the epoch of the live sample behind `latest`. It is `null` for every range but `now`, and on `now` while the live file is missing or more than 6 s old; each site's `latest` then falls back to the last sweep. When it is set, each `kind: "site"` entry with a live result gets that result as `latest`, with `ts = live_at`; a site the last sweep did not include stays `latest: null`. `summary.answered` counts the same `latest` the cells show.
- `wans` and the per-sample `wan` exist so a multi-WAN UI fits later; today the value is always `"cellular"`.
- Torn or malformed history lines are filtered by a `grep -E` row pattern before aggregation; aggregation is `awk`, because jq is too slow on ~28k rows. Measured on RM520N-GL: a synthetic 90-day history read in 3.4 s, 30/90-day reads about 3.3 s, 24 h in 0.7 s.

### `POST {"action":"check_now"}`

Also accepted as `?action=check_now`. Raises the flag → `{ "success": true }`. When the monitor is disabled → `{ "success": false, "error": "disabled", "detail": "Sites monitor is turned off" }`.

### `POST {"action":"save","enabled":true,"interval_sec":300,"sites":[{"host":"…","label":"…"}]}`

- `enabled` must be a boolean, `sites` a list of at most 32, and every `host` must pass the same host check as the daemon (lower-cased first). Failures → `{ "success": false, "error": "invalid_field", "field": "sites", "reason": "invalid host" }`.
- `interval_sec` must be a number and is **clamped** to 60–3600, not rejected.
- A `label` keeps printable characters only, is cut to 40, and falls back to the host. Duplicate hosts are dropped.
- After the write, `enabled: true` raises the check-now flag and `enabled: false` removes the live lease.
- The file is written by `mktemp` in `/etc/qmanager` + `mv`. The response echoes the saved config: `{ "success": true, "enabled": …, "interval_sec": …, "sites": [ … ] }`.

## Install and uninstall

- `install_backend` creates `/usrdata/qmanager/sites` with `install -d -o root -g root -m 0755` (never `mkdir -p`, which would keep a wrong mode on a re-install).
- `qmanager-sites` is in the `start_services` loop; `stop_services` and the boot wants-symlink loop pick it up by the `qmanager-*.service` glob.
- `uninstall_rm520n.sh --purge` removes `/usrdata/qmanager/sites`, which would otherwise block the final `rmdir` of `/usrdata/qmanager`.

## Related docs

- [latency-monitor.md](latency-monitor.md) — the Sites card, `hooks/use-sites.ts` and the Manage dialog
- [connection-quality.md](connection-quality.md) — the reachability verdict and DNS lookup time this daemon does not replace
- [tmp-file-ownership.md](tmp-file-ownership.md) — `fs.protected_regular` and cross-UID `/tmp` files
- [scheduled-timers.md](scheduled-timers.md) — the 1970 boot window behind the wall-clock gate
