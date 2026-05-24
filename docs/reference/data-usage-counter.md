# Data Usage Counter

> The persistent data-usage counter reads directly from the kernel's `/proc/net/dev` byte counters for the cellular interface. Schema v4 adds per-boot **dynamic orientation detection** — an empirical probe that confirms whether field 2 carries downloads or uploads on the current firmware, rather than trusting the kernel column layout blindly.

Kernel-sourced design landed in v0.1.11 (schema v3). Schema v4 added per-boot orientation detection after we discovered the SDX55 IPA driver attributes fast-path bytes to the swapped column under certain build configurations. See [`data-counter-platform-matrix.md`](./data-counter-platform-matrix.md) for the cross-SoC evidence.

---

## Source of truth: /proc/net/dev

The persistent data-usage counter lives in `qmanager_poller` and is stored at `/usrdata/qmanager/data_used.json`. It reads two byte fields from `/proc/net/dev` for `$NETWORK_IFACE` — `rmnet_ipa0` on RM520N-GL, `wwan0` on RM551E.

By convention the kernel layout puts RX bytes at field 2 and TX bytes at field 10. This holds for slow-path traffic on every probed device. **It does not always hold for fast-path (IPA-offloaded) traffic** — some SDX55 driver builds attribute offloaded bytes to the swapped column. Schema v4 detects orientation empirically per boot rather than assuming the convention.

---

## Schema v4

Schema v4 keeps the v3 storage model and adds orientation state. **Migration is in-place** — existing v3 accumulators are preserved across the upgrade; the v3-to-v2 discard behavior remains.

**`data_used.json` persisted fields (schema v4):**

| Field | Description |
|-------|-------------|
| `schema` | `4` — version guard; v2 files are discarded on startup, v3 files are upgraded in place |
| `accumulated_rx_bytes` | Running total of RX bytes since last user-triggered reset |
| `accumulated_tx_bytes` | Running total of TX bytes since last user-triggered reset |
| `selected_counter` | The kernel interface name used as source (e.g. `rmnet_ipa0`) |
| `last_update_ts` | Unix timestamp of the last successful counter update |
| `last_reset_ts` | Unix timestamp of the last user-triggered reset |
| `modem_reset_count` | How many times a negative kernel delta was detected (modem reboots) |
| `prev_ipa_rx` | Last raw kernel RX value — baseline for next delta computation |
| `prev_ipa_tx` | Last raw kernel TX value — baseline for next delta computation |
| `orientation_state` | `pending` \| `detected_normal` \| `detected_reversed` \| `fallback` |
| `orientation_history_swapped` | Boolean. Set true the one time accumulators were swapped to correct a reversed verdict; prevents re-swap on subsequent reversed re-detections |

**CGI response additions:** the `data_used` block in `fetch_data.sh` output includes `stale: true` when the file mtime is stale, and surfaces `orientation_state` for diagnostics. The legacy v2 fields (`orientation`, `orientation_calibrated`, `orientation_attempts`, `divergence_count`, `mode_transition_count`) remain gone; do not reference them.

---

## Orientation detection

### State machine

```
pending ──probe──► detected_normal     (field 2 = DL, field 10 = UL)
        ──probe──► detected_reversed   (field 2 = UL, field 10 = DL)
        ──probe──► fallback            (probe inconclusive; use defaults: field 2 = DL)
```

`fallback` behaves identically to `detected_normal` for accumulation; the distinct state exists so diagnostics can tell "we tried and gave up" apart from "we confirmed normal".

### Probe spec

- **Trigger:** runs once at the first WAN-up after service start (Option A), and re-runs on any counter-reset event — PDN re-establish or modem reboot (Option B). **No periodic probes.**
- **Payload:** 5 MB minimum download from Cloudflare.
- **Timeout:** 90 seconds total.
- **Classification thresholds:** requires at least 1 MB total delta across the two candidate fields AND at least a 5:1 ratio between them. Below either threshold, the verdict is `fallback`.
- **Concurrency:** runs in a backgrounded subshell. The subshell owns the pidfile lifecycle via `$BASHPID` (not the parent's `$$`) — this avoids a parent-vs-subshell race on fast-failure paths where the parent could otherwise tear down the pidfile while the subshell is still using it.

### Schema v3 → v4 in-place migration

On upgrade, the poller leaves `accumulated_rx_bytes` and `accumulated_tx_bytes` untouched. The first orientation probe then runs as if from a fresh boot. **If — and only if — the first verdict is `detected_reversed` and `orientation_history_swapped` is false**, the accumulators are swapped once and the flag is set. Subsequent boots that re-detect `reversed` won't re-swap; the historical totals are only realigned a single time.

### Boot-window caveat

Between service start and the first orientation verdict (up to 90 seconds), accumulation runs against the default orientation. If the live firmware turns out to be `reversed`, bytes that flowed during that probe window are labeled with the wrong direction. The mislabeled volume is at most a few minutes of traffic vs lifetime totals measured in GB — **negligible in practice** — but worth knowing about when interpreting `orientation_state == "detected_reversed"` on a long-uptime device.

---

## Counter-reset detection

If a tick produces a negative kernel delta — meaning the modem rebooted or the cellular interface was re-created — the poller rebases its baseline to the new (lower) kernel values without accumulating the in-flight bytes, and increments `modem_reset_count`. Users see no negative numbers; the accumulated total holds steady for that tick and then resumes climbing from the new baseline.

---

## Critical shebang warning: #!/bin/bash required

**The poller's shebang must remain `#!/bin/bash`.** Do NOT change it to `#!/bin/sh` or allow it to run under BusyBox `sh`.

**Why this matters:** BusyBox `sh` uses a 32-bit signed `long` for shell arithmetic (`$(( ))`) and comparisons (`-lt`). The cumulative data accumulator wraps around to a large negative number once it crosses approximately 2.15 GB, making the displayed counter wrong and unrecoverable without a reset. Bash 3.2 (the version on this platform) uses 64-bit `intmax_t` for arithmetic, so it handles accumulator values far beyond what any real-world session will reach.

The same constraint applies to **any other script that accumulates byte volumes across reboots** — always use `#!/bin/bash` for those.
