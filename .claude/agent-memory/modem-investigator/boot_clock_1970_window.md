---
name: boot-clock-1970-window
description: RM520N-GL boots at 1970 (free-running non-battery RTC) and ql_time_daemon steps the clock ~56y forward at boot+~15-25s; timers.target arms at boot+6.3s, INSIDE that window
metadata:
  type: project
---

The RM520N-GL has **no battery-backed RTC**. `rtc-pm8xxx` free-runs from 0 at
power-on; `hctosys=1` seeds the system clock from it, so every boot starts in
1970. The Quectel firmware daemon `/usr/bin/ql_time_daemon`
(`ql_time_daemon.service`, `AmbientCapabilities=CAP_SYS_TIME`, boot-enabled via
`/lib/systemd/system/multi-user.target.wants/`) steps the system clock forward
once the modem gets network time, and drops the timestamp in
`/tmp/ql_time_set_ready.flag` (contents: `RTC:YYYY-MM-DD HH:MM:SS`). It does
**not** write the hardware RTC back — `hwclock -r` still reads 1970 hours after
the step, and `timedatectl` shows `RTC time: Fri 1970-01-…` alongside a correct
`Universal time`.

Measured boot timeline (boot 2026-08-01 10:29:39, observed 2026-08-02):

| Monotonic | Wall clock as systemd recorded it |
|---|---|
| 6.31s | `systemd-tmpfiles-clean.timer` active — `1970-01-01 09:51:58` |
| 6.37s | `timers.target` active — `1970-01-01 09:51:58` |
| ~22s | `basic.target` — `1970-01-01 09:52:14` |
| ~23s | `ql_time_daemon` ExecMainStart — `1970-01-01 09:52:15` |
| ~+1s | **clock steps to `2026-08-01 10:29:54`** |
| ~30s | `multi-user.target` — `2026-08-01 10:30:09` |

**Why: `timers.target` is reached ~17 seconds BEFORE the clock step.** Any
`.timer` symlinked into `/lib/systemd/system/timers.target.wants/` computes its
first `OnCalendar` elapse against a 1970 clock, then the forward step lands far
past it.

**How to apply:** when investigating anything schedule-, expiry-, or
timestamp-at-boot-related, assume the first ~20s of every boot runs at epoch 0.
`Persistent=false` does not protect against this (it only governs across-reboot
stamp-file catch-up, not a within-boot clock step).

### Debug recipe — proving the step without journald

journald is disabled device-wide (see [[live_observability_and_sim_hardware]]),
so `journalctl -b` is useless. Use these instead:

- `cat /tmp/ql_time_set_ready.flag` — exact step timestamp
- `head -12 /var/log/messages.0` — BusyBox syslogd captures the jump *inside one
  file*: consecutive `usbd` uevent lines go `Jan  1 09:52:16` → `Aug  1 10:29:54`
- `ls -la --full-time /tmp` — pre-step files (`systemd-private-*`) keep 1970 mtimes
- `systemctl show timers.target -p ActiveEnterTimestamp -p ActiveEnterTimestampMonotonic`
  — the load-bearing one; shows timers arm in 1970
- `cat /sys/class/rtc/rtc0/since_epoch` vs `cat /proc/uptime` — the difference is
  how far the RTC had free-run before this boot
