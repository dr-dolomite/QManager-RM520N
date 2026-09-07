---
name: reference_crash_log_has_three_readers
description: /etc/qmanager/crash.log has three read sites across two files — a doc that enumerates its line shapes must name all three, because missing the watchdog one was a live regression
type: reference
---

`/etc/qmanager/crash.log` is `<epoch>|<verb>|<tag>`. Since 2026-09 it carries
**two** line shapes: `|reboot|` (tier4_escalation / user / scheduled) and
`|skip|` (the scheduled-reboot worker's clock-step guard, which logs why it
declined to reboot — this platform has no logs at all, journald is masked to
/dev/null and /tmp is wiped each boot, so the file IS the trace).

**Three read sites, two files.** All three filter on field 2:

- `alert_engine.sh` → `_ae_classify_reboot` — `grep '|reboot|' | tail -n 1`
- `alert_engine.sh` → `_ae_deliver_reboot` — coalescer, `awk '$2 == "reboot"'`
- `qmanager_watchcat` → `count_recent_reboots()` — `awk '$2 == "reboot"'`

**Why:** the third one lives in a different file and was MISSED when the `skip`
shape was added. The skip lines were counted as reboots by the watchdog's hourly
budget, which tripped the cap and silently disabled its Tier-4 recovery rung for
an hour. A real regression, caught late.

**How to apply:** any doc that enumerates crash.log's line shapes, or any change
adding a third shape, must account for all three readers — and say so in the
doc, not just fix the code. The contract lives in `docs/reference/alerts.md`
under "The `crash.log` line contract"; `scheduled-timers.md` and
`connection-watchdog.md` both point at it rather than restating it. The reboot
cause vocabulary is `watchdog | user | scheduled | unplanned` and appears in
three places that must agree: `_ae_classify_reboot`'s case, `RebootCause` in
`types/alerts.ts`, and four `Record<RebootCause, …>` maps in
`components/monitoring/alerts/alerts-log-card.tsx` (those four are
compiler-enforced; the shell side is not). See also
[[reference_1970_boot_window_timer_guard]].
