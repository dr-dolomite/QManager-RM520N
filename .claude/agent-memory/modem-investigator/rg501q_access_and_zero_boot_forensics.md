---
name: rg501q-access-and-zero-boot-forensics
description: RG501Q-EU lives at 192.168.120.1 (not MODEM_IP); it has NO boot forensics at all — journald storage absent AND /var/log is tmpfs with zero systemd entries
metadata:
  type: reference
---

**The RG501Q-EU test device is at `192.168.120.1`**, moved there 2026-08-25 to stop
colliding with the RM520N-GL. `MODEM_IP` in `.env` still points at the RM520N-GL
(`192.168.225.1`). Same `MODEM_SSH_USER` / `MODEM_SSH_PASSWORD` on both.

**There is no way to reconstruct a past boot on this device.** Two independent
gaps, both measured 2026-08-25:

- `journalctl -b` → `No journal files were found.` Neither `/var/log/journal`
  nor `/run/log/journal` exists, so journald stores nothing at all.
- `/var/log` is a symlink to `volatile/log`, and `/var/volatile` is **tmpfs**.
  So `/var/log/messages` is wiped every boot — there is never a `messages.0`
  to rotate into, and `ls -l /var/log/messages*` returning a single file is not
  evidence of "hasn't rotated yet", it is evidence the history is gone.
- Worse, `grep -c systemd /var/log/messages` returns **0**. busybox syslogd
  never receives systemd's unit messages even for the *current* boot, despite
  `ForwardToSyslog=yes` in `journald.conf` — because journald itself has no
  storage to forward from. So "Failed to start X", `203/EXEC`,
  `start request repeated too quickly` are unobtainable, current boot included.

**How to do boot forensics anyway:** `systemctl show` monotonic timestamps are
the only durable record, and they survive for the current boot only:
`InactiveExitTimestampMonotonic` (unit began activating / `ExecStartPre` start),
`ExecMainStartTimestampMonotonic` (`ExecStart` forked), `ActiveEnterTimestampMonotonic`,
plus `NRestarts` and `Result`. Diffing InactiveExit against ExecMainStart gives
the `ExecStartPre` duration, which is how the lighttpd F8 timeline was
reconstructed. Cross-check against any daemon that keeps its own dated logfile
(`/opt/var/log/lighttpd/error.log` survives reboots — it is on ubi2_0 — and its
`server stopped by UID = 0 PID = 1` lines mark past shutdowns).

Related: [[boot_clock_1970_window]] — same no-RTC 1970 window applies here, so
pre-clock-step timestamps are valid as *ordering* only.
