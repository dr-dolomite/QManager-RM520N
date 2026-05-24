# Real-Time Cellular Traffic Counters

> **Status: Superseded — Live Traffic feature removed in the 2026-05-24 release.** The `qmanager_traffic` daemon, `fetch_traffic.sh` CGI, `useTrafficStream` hook, and Device Metrics Live Traffic row are all gone. The IPA hardware fast path makes per-second `/proc/net/dev` deltas systematically blind to forwarded LAN→WAN traffic, so the daemon's per-tick reads could only see on-modem-originated bytes — a structural limitation, not a fixable bug. See [`../reference/data-counter-platform-matrix.md`](../reference/data-counter-platform-matrix.md) for the full why. Cumulative Data Used (now schema v4 with dynamic orientation detection) continues to work because IPA flushes catch up over time even when per-tick reads miss them.

**Date:** 2026-05-08
**Branch:** development
**Status:** Design — superseded

## Context

The dashboard's "Live Traffic" row updates only every 2 s because it rides the main `qmanager_poller` cycle. The poller reads `/proc/net/dev` directly (the `AT+QGDCNT?` migration was completed earlier and is not part of this work), but the cadence ties the speed display to AT-bound work that has no reason to gate it. `/proc/net/dev` is a single-line file read; per `docs/rm520n-sysfs-fetch-sources.md` it has no AT-lock contention and `awk` over it is cheap on this platform.

There is also no surfaced cumulative-totals figure, even though the poller already emits `total_rx_bytes` / `total_tx_bytes` in its cache. Users want to see how much cellular data has been consumed since the modem came up.

## Goal

1. Add a "Data Used" row above the existing "Live Traffic" row in the Device Metrics card showing cumulative `total_rx_bytes` / `total_tx_bytes` since modem boot.
2. Make the "Live Traffic" speed update at 1 Hz end-to-end (backend read → cache file → CGI → frontend render).
3. Auto-pick the active cellular interface (`rmnet_ipa0` preferred, `rmnet_data0` fallback). Show 0/0 cleanly if neither is up.

## Non-goals

- LAN / `bridge0` / `eth0` traffic visibility — this card is cellular-only.
- Per-interface UI selector — one cellular interface is enough for the user persona.
- Billing-cycle / monthly tracking. The displayed totals reset when the modem subsystem restarts; that is an explicit and acceptable property.
- Persisting totals across modem reboots.
- Removing `total_rx_bytes` / `total_tx_bytes` from the main poller cache — other consumers (Discord bot) read those.
- Migrating away from `AT+QGDCNT` — already done.

## Counter semantics (locked)

`/proc/net/dev` `rx_bytes` / `tx_bytes` for the cellular rmnet are monotonic byte counters since the interface came up. They reset on:

- Full device reboot.
- Modem subsystem restart (SSR) — the kernel re-creates the rmnet, counter starts at 0.

They do **not** reset on QManager restart, on cellular session re-establishment that does not bounce the iface, or on any user action in QManager. UI labelling reflects "since modem boot."

## Architecture

```
/proc/net/dev (rmnet_ipa0 | rmnet_data0)
        │  every 1 s, single awk pass
        ▼
qmanager_traffic daemon  ──atomic write──▶  /tmp/qmanager_traffic.json
                                                    │
                                                    │ cat + JSON headers
                                                    ▼
                                          fetch_traffic.sh (CGI)
                                                    │
                                                    │ HTTP, every 1 s
                                                    ▼
                                          useTrafficStream() hook
                                                    │
                                                    ▼
                            DeviceMetrics: "Data Used" + "Live Traffic" rows
```

The path is independent of the existing 2 s `qmanager_poller` → `fetch_data.sh` → `useModemStatus` path. This mirrors the existing side-channel pattern used by `qmanager_ping`, which writes `/tmp/qmanager_ping.json` for the poller to pick up.

### Active-interface selection (in daemon)

1. Prefer `$NETWORK_IFACE` (`rmnet_ipa0` on RM520N-GL — `/etc/quectel-project-version` gates this, same logic as the poller).
2. If `/sys/class/net/<iface>/operstate` is not `up`, try `rmnet_data0`.
3. If neither is up, emit `{iface: null, total_rx_bytes: 0, total_tx_bytes: 0, rx_bytes_per_sec: 0, tx_bytes_per_sec: 0}`.

Selection runs every tick — if the modem comes back after an SSR, the daemon picks the iface up again on its next read without restart.

### Counter-reset handling

If a delta computes negative (because the modem SSR re-created the interface and counters dropped to 0), treat as a fresh baseline: emit `0` for that tick, store the new low value as `prev`, and resume normal delta computation on the next tick. No retroactive correction; users will see a single zero blip, which is correct semantically.

## Components

### 1. `qmanager_traffic` daemon

- **Path:** `scripts/usr/bin/qmanager_traffic`
- **Shape:** ~80-line bash script. `set -eu`. Sources `qlog.sh` for logging consistency.
- **Loop:** `INTERVAL=1` second. Per tick: pick iface → one `awk` pass over `/proc/net/dev` for rx/tx bytes → compute deltas vs previous tick using elapsed wall time (floor at 1 s; same anti-blocking-skew rule as the poller's traffic block) → atomic write of `/tmp/qmanager_traffic.json` (`.tmp` + `mv`).
- **No** AT calls, no `flock`, no `/opt/bin` dependencies. Tools used: `awk`, `cat`, `date`, `mv`. All in BusyBox / coreutils.
- **JSON shape:**
  ```json
  {
    "ts": 1715200123,
    "iface": "rmnet_ipa0",
    "total_rx_bytes": 4521234567,
    "total_tx_bytes": 812345678,
    "rx_bytes_per_sec": 12400000,
    "tx_bytes_per_sec": 1100000
  }
  ```

### 2. `qmanager-traffic.service`

- **Path:** `scripts/etc/systemd/system/qmanager-traffic.service` (the installer copies `$SRC_SCRIPTS/etc/systemd/system/qmanager*.service` to `/lib/systemd/system/` on the target).
- **Type:** `simple`, `Restart=always`, `RestartSec=2`, `User=root`.
- **Boot persistence:** direct symlink into `/lib/systemd/system/multi-user.target.wants/` via the existing `svc_enable` helper in `platform.sh`. `systemctl enable` does not work on this platform per CLAUDE.md.

### 3. `fetch_traffic.sh` CGI

- **Path:** `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh`
- **Shape:** ~25-line bash. Sources `cgi_base.sh` (auth gate + JSON headers).
- **Behaviour:** read `/tmp/qmanager_traffic.json` and emit it. If file mtime > 5 s old, add `"stale": true` to the payload. If file missing entirely, emit a zeroed payload with `iface: null` and `stale: true`.
- No AT lock, no shell forks beyond the read.

### 4. `useTrafficStream` hook

- **Path:** `hooks/use-traffic-stream.ts`
- **Modeled on** `hooks/use-modem-status.ts`: `setInterval` polling, `mountedRef` guard, staleness detection. (No visibility-pause — match the existing hook pattern; doubling read frequency without pause is acceptable on this platform.)
- **Default `pollInterval`:** 1000 ms. Configurable via opts.
- **Return:** `{data: TrafficStream | null, isLoading, isStale, error}`.
- **Type** added to `types/modem-status.ts`:
  ```ts
  export interface TrafficStream {
    ts: number;
    iface: string | null;
    total_rx_bytes: number;
    total_tx_bytes: number;
    rx_bytes_per_sec: number;
    tx_bytes_per_sec: number;
    stale?: boolean;
  }
  ```

### 5. UI — `device-metrics.tsx` + `home-component.tsx`

- New prop `trafficStream: TrafficStream | null` on `DeviceMetricsComponent`.
- Reuse the existing `formatBytes(bytes)` exported from `types/modem-status.ts:565` (formats as `B`/`KB`/`MB`/`GB`). No new helper needed.
- New "Data Used" row inserted above "Live Traffic":
  ```tsx
  <Separator />
  <div className="flex items-center justify-between">
    <p className="font-semibold text-muted-foreground text-sm">Data Used</p>
    <div className="flex items-center gap-x-2">
      <div className="flex items-center gap-1">
        <TbCircleArrowDownFilled className="text-info size-5" />
        <p className="font-semibold text-sm tabular-nums">{formatBytes(totalRx)}</p>
      </div>
      <div className="flex items-center gap-1">
        <TbCircleArrowUpFilled className="text-purple-500 size-5" />
        <p className="font-semibold text-sm tabular-nums">{formatBytes(totalTx)}</p>
      </div>
    </div>
  </div>
  ```
- Live Traffic row: speed values resolve from `trafficStream` first, falling back to `trafficData` (slow cache) so the card never goes blank if the daemon is starting or down.
- `home-component.tsx`: adds `const { data: trafficStream } = useTrafficStream();` and threads it through.

### 6. Installer wiring — `scripts/install_rm520n.sh`

The installer globs `qmanager-*.service` for both the copy phase (line 678) and the enable phase (line 1113), and the legacy-cleanup scan (line 989) is filesystem-driven on the same glob. **No installer edits are required**: dropping `qmanager-traffic.service` into `scripts/lib/systemd/system/` and `qmanager_traffic` into `scripts/usr/bin/` is sufficient for fresh installs and OTA upgrades. Verify post-install that the symlink in `multi-user.target.wants/` is created and the service is `active (running)`.

## Error & edge cases

| Scenario | Behaviour |
|---|---|
| Daemon stopped / not yet started | CGI emits zeroed payload with `stale: true`. Hook surfaces `isStale`. UI row falls back to slow-cache speed values; cumulative row shows last-known totals from slow cache if available, else `0 B`. Card never goes blank. |
| Both `rmnet_ipa0` and `rmnet_data0` operstate ≠ `up` | Daemon emits `{iface: null, totals: 0, speed: 0}`. UI shows zeros. (No "cellular down" badge in v1 — keep scope tight; the existing connection-status indicators in other cards already convey this.) |
| Modem SSR mid-tick (counter reset) | Negative delta detected → emit 0 for that tick, reseed baseline, resume normally on next tick. |
| u64 wrap | Will not occur in practice on this hardware. Same negative-delta guard would handle it harmlessly if it ever did. |
| CGI file missing | Emit zeroed payload with `stale: true`. |
| Frontend tab hidden | Hook stops polling — saves bytes on field tablets. Resumes on visibility. |

## Verification

- Daemon writes `/tmp/qmanager_traffic.json` once per second; mtime stays current under `stat`.
- `curl http://127.0.0.1/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh` returns the same shape every second; `stale` flips to `true` after stopping the daemon for >5 s.
- With a `iperf3 -c <server>` running, dashboard "Live Traffic" updates visibly at 1 Hz, "Data Used" climbs monotonically.
- Stop iperf3 → speed drops to ~0 within 2 ticks; totals stay at the new high-water mark.
- `systemctl restart qmanager-traffic` → at most one tick of zero, then resumes.
- Bring the cellular interface down (`ip link set rmnet_ipa0 down`) → daemon falls back to `rmnet_data0` if up; if both down, emits `iface: null` and zeros.
- Modem SSR (force a crash via `/sys/devices/platform/4080000.qcom,mss/subsys0/restart` if available) → counters drop to 0, daemon emits one zero tick, then resumes from new baseline. No negative numbers ever surface to the UI.

## Out of scope

- Bridge0 / eth0 traffic display.
- User-selectable interface in UI.
- Billing-cycle counters.
- Cross-reboot persistence of totals.
- Folding the daemon's read back into the poller to eliminate the duplicate `/proc/net/dev` read in the slow path. The slow-path read is a fallback for when the daemon is down — keep it.
