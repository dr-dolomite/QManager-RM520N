# Data Usage Counter

> The persistent data-usage counter reads directly from the kernel's `/proc/net/dev` byte counters for the cellular interface. Schema v5 uses a **static SoC-based orientation map** (read once at startup from `/etc/quectel-project-version`) instead of the per-boot Cloudflare probe that v4 ran.

Kernel-sourced design landed in v0.1.11 (schema v3). Schema v4 added a per-boot probe; v5 replaces the probe with a static SoC-keyed table after observed probe misclassifications on RM520N-GL under live traffic. See [`data-counter-platform-matrix.md`](./data-counter-platform-matrix.md) for the cross-SoC evidence behind the static map.

---

## Source of truth: /proc/net/dev

The persistent data-usage counter lives in `qmanager_poller` and is stored at `/usrdata/qmanager/data_used.json`. It reads two byte fields from `/proc/net/dev` for `$NETWORK_IFACE` — `rmnet_ipa0` on RM520N-GL, `wwan0` on RM551E.

By convention the kernel layout puts RX bytes at field 2 and TX bytes at field 10. This holds for slow-path traffic on every probed device. **It does not always hold for fast-path (IPA-offloaded) traffic** — some SDX55 driver builds attribute offloaded bytes to the swapped column. Schema v5 picks the correct orientation by SoC, using a static map keyed off `/etc/quectel-project-version`'s `Branch Name`.

---

## Schema v5

Schema v5 keeps the v3 storage model and adds an `orientation` field. **v3/v4 → v5 upgrade resets accumulators** because previous totals may have been recorded against an incorrect (probe-derived) orientation. Users see this as a one-time fresh start of the Data Used counter after upgrading to v5.

**`data_used.json` persisted fields (schema v5):**

| Field | Description |
|-------|-------------|
| `schema` | `5` — version guard; v2 and older are discarded; v3/v4 trigger an accumulator reset on upgrade |
| `accumulated_rx_bytes` | Running total of RX bytes since last reset |
| `accumulated_tx_bytes` | Running total of TX bytes since last reset |
| `selected_counter` | Kernel interface name used as source (e.g. `rmnet_ipa0`) |
| `orientation` | `normal` \| `reversed` — replaces v4's `orientation_state` |
| `last_update_ts` | Unix timestamp of the last successful counter update |
| `last_reset_ts` | Unix timestamp of the last user-triggered reset (also stamped on v3/v4 upgrade) |
| `modem_reset_count` | How many times a negative kernel delta was detected (modem reboots) |
| `prev_ipa_rx` | Last raw kernel RX value — baseline for next delta computation |
| `prev_ipa_tx` | Last raw kernel TX value — baseline for next delta computation |

**Removed in v5:** `orientation_state`, `orientation_history_swapped`, and the entire async probe state (`ORIENTATION_*` constants, `start_orientation_probe`, `apply_orientation_result`).

**CGI response:** the `data_used` block in `fetch_data.sh` output includes `stale: true` when the file mtime is stale, and surfaces `orientation` (rather than v4's `orientation_state`) for diagnostics. The legacy v2 fields (`orientation_calibrated`, `orientation_attempts`, `divergence_count`, `mode_transition_count`) remain gone; do not reference them.

---

## Orientation map

The orientation is resolved once at poller startup by `detect_orientation_from_soc()` (in `scripts/usr/bin/qmanager_poller`) and held in memory for the process lifetime. Modem reboots do NOT re-evaluate the map — the SoC does not change at runtime.

| SoC `Branch Name` in `/etc/quectel-project-version` | Orientation | `/proc/net/dev` DL field | UL field |
|---|---|---|---|
| `SDX6X` (SDX65 / x62 — RM520N-GL) | `normal` | 2 | 10 |
| `SDX55` (RM502Q-AE) | `reversed` | 10 | 2 |
| anything else / missing / blank | `normal` | 2 | 10 |

To add a new SoC to the table, edit `detect_orientation_from_soc()` in the poller. There is no runtime override.

---

## Counter-reset detection

If a tick produces a negative kernel delta — meaning the modem rebooted or the cellular interface was re-created — the poller rebases its baseline to the new (lower) kernel values without accumulating the in-flight bytes, and increments `modem_reset_count`. Users see no negative numbers; the accumulated total holds steady for that tick and then resumes climbing from the new baseline.

---

## Critical shebang warning: #!/bin/bash required

**The poller's shebang must remain `#!/bin/bash`.** Do NOT change it to `#!/bin/sh` or allow it to run under BusyBox `sh`.

**Why this matters:** BusyBox `sh` uses a 32-bit signed `long` for shell arithmetic (`$(( ))`) and comparisons (`-lt`). The cumulative data accumulator wraps around to a large negative number once it crosses approximately 2.15 GB, making the displayed counter wrong and unrecoverable without a reset. Bash 3.2 (the version on this platform) uses 64-bit `intmax_t` for arithmetic, so it handles accumulator values far beyond what any real-world session will reach.

The same constraint applies to **any other script that accumulates byte volumes across reboots** — always use `#!/bin/bash` for those.
