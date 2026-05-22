# Data Usage Counter

> The persistent data-usage counter reads directly from the kernel's `/proc/net/dev` byte counters for the cellular interface. No AT command, no orientation calibration, no firmware-specific field order to guess.

Kernel-sourced design landed in v0.1.11 (schema v3). Prior AT+QGDNRCNT-based design was retired.

---

## Source of truth: /proc/net/dev

The persistent data-usage counter lives in `qmanager_poller` and is stored at `/usrdata/qmanager/data_used.json`. It reads `rx_bytes` (field 2) and `tx_bytes` (field 10) directly from `/proc/net/dev` for `$NETWORK_IFACE` — `rmnet_ipa0` on RM520N-GL, `wwan0` on RM551E.

The `/proc/net/dev` column layout is defined by the Linux kernel and is identical across all firmware versions: after the `iface:` token, field 2 is always RX bytes and field 10 is always TX bytes. There is no firmware-specific field ordering to resolve, so the orientation-calibration step that existed in the prior design was unnecessary and has been removed entirely.

---

## Schema v3

On first run of the new poller, any existing `data_used.json` at schema v2 is discarded. The counter re-baselines cleanly from the current kernel counters. This auto-heals modems whose old orientation calibration had mis-fired (swapping TX/RX or under-counting).

**`data_used.json` persisted fields (schema v3):**

| Field | Description |
|-------|-------------|
| `schema` | `3` — version guard; v2 files are discarded on startup |
| `accumulated_rx_bytes` | Running total of RX bytes since last user-triggered reset |
| `accumulated_tx_bytes` | Running total of TX bytes since last user-triggered reset |
| `selected_counter` | The kernel interface name used as source (e.g. `rmnet_ipa0`) |
| `last_update_ts` | Unix timestamp of the last successful counter update |
| `last_reset_ts` | Unix timestamp of the last user-triggered reset |
| `modem_reset_count` | How many times a negative kernel delta was detected (modem reboots) |
| `prev_ipa_rx` | Last raw kernel RX value — baseline for next delta computation |
| `prev_ipa_tx` | Last raw kernel TX value — baseline for next delta computation |

**CGI response additions:** the `data_used` block in `fetch_data.sh` output also includes `stale: true` when the file mtime is stale. The `orientation`, `orientation_calibrated`, `orientation_attempts`, `divergence_count`, and `mode_transition_count` fields from schema v2 are gone; do not reference them.

---

## Counter-reset detection

If a tick produces a negative kernel delta — meaning the modem rebooted or the cellular interface was re-created — the poller rebases its baseline to the new (lower) kernel values without accumulating the in-flight bytes, and increments `modem_reset_count`. Users see no negative numbers; the accumulated total holds steady for that tick and then resumes climbing from the new baseline.

---

## Critical shebang warning: #!/bin/bash required

**The poller's shebang must remain `#!/bin/bash`.** Do NOT change it to `#!/bin/sh` or allow it to run under BusyBox `sh`.

**Why this matters:** BusyBox `sh` uses a 32-bit signed `long` for shell arithmetic (`$(( ))`) and comparisons (`-lt`). The cumulative data accumulator wraps around to a large negative number once it crosses approximately 2.15 GB, making the displayed counter wrong and unrecoverable without a reset. Bash 3.2 (the version on this platform) uses 64-bit `intmax_t` for arithmetic, so it handles accumulator values far beyond what any real-world session will reach.

The same constraint applies to **any other script that accumulates byte volumes across reboots** — always use `#!/bin/bash` for those.
