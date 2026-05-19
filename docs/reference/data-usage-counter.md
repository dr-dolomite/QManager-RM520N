# Data Usage Counter

> The persistent data-usage counter uses AT+QGDNRCNT as its single source of truth and includes an active calibration step to handle firmware variants that report TX/RX fields in reversed order.

Bug 1 + Bug 2 fix landed in v0.1.10.

---

## Source of truth: AT+QGDNRCNT

The persistent data-usage counter lives in `qmanager_poller` and is stored at `/usrdata/qmanager/data_used.json`. It uses `AT+QGDNRCNT` as the single source of truth across LTE, NSA, and SA — empirically verified to track all RAT (Radio Access Technology) traffic identically on firmware `RM520NGLAAR03A03M4G`.

---

## Firmware-specific field order problem

**Field order in `+QGDNRCNT` is firmware-specific.** Quectel's public documentation specifies `<TX>,<RX>` (which AAR03A03 follows), but at least one user-reported firmware returns the fields reversed (`<RX>,<TX>`). If the poller blindly trusts the documented order on a reversed-field firmware, RX bytes get counted as TX and vice versa.

---

## Active calibration procedure

The poller resolves the field-order ambiguity at runtime with a one-time **active calibration**:

1. Drives a **1 MB curl download** to `speed.cloudflare.com/__down?bytes=1048576`.
2. Snapshots the `AT+QGDNRCNT` counter values AND `/proc/net/dev rmnet_ipa0` kernel counters **before and after** the download.
3. Compares the deltas: whichever AT field grew in lockstep with the kernel's RX delta is locked in as the `rx` field.
4. The resolved field orientation is written to `data_used.json` as `du_orientation` and is **never re-evaluated** — it persists across reboots until the user manually triggers a reset.

### Calibration gates and failure cap

- Calibration only runs when `conn_internet_available == "true"` (the modem must have an active internet connection to drive the test download).
- The calibration attempt is **capped at 10 tries**. Past the cap, the poller freezes at the Quectel-public default `"tx,rx"` orientation and emits a `data_calibration_failed` event.

---

## Critical shebang warning: #!/bin/bash required

**The poller's shebang must remain `#!/bin/bash`.** Do NOT change it to `#!/bin/sh` or allow it to run under BusyBox `sh`.

**Why this matters:** BusyBox `sh` uses a 32-bit signed `long` for shell arithmetic (`$(( ))`) and comparisons (`-lt`). The cumulative data accumulator wraps around to a large negative number once it crosses approximately 2.15 GB, making the displayed counter wrong and unrecoverable without a reset. Bash 3.2 (the version on this platform) uses 64-bit `intmax_t` for arithmetic, so it handles accumulator values far beyond what any real-world session will reach.

The same constraint applies to **any other script that accumulates byte volumes across reboots** — always use `#!/bin/bash` for those.
