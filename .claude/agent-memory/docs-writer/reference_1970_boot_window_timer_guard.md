---
name: reference_1970_boot_window_timer_guard
description: Any new systemd .timer on RM520N must address the 1970 clock-step spurious fire — full mechanism and forward rule live in scheduled-timers.md
type: reference
---

RM520N-GL has no battery RTC. Every boot starts at CLOCK_REALTIME=1970 until
stock `ql_time_daemon` steps it to the real date ~24s in (network-sourced,
needs a registered SIM — no SIM means 1970 forever). systemd 244 arms
`OnCalendar=` timers against that 1970 base at `timers.target` (~6.4s
monotonic, ~17s before the step) and has no past-base clamp, so every armed
timer fires once, spuriously, at the clock step. It self-heals after that one
fire — it only becomes a loop if the payload is `reboot` (resets the clock,
re-arms the trap). This was issue #9 (Scheduled Reboot boot-loop), fixed
2026-08 by a worker-side guard (`_qm_timer_fire_allowed` in
`schedule_timer.sh`), documented in full in
`docs/reference/scheduled-timers.md` under "The 1970 boot window" — mechanism,
exposure table for all 4 timer families, the guard contract, an explicit
non-fixes list (Persistent=false/true, day masks, epoch floors,
time-sync.target ordering, monotonic timers, `ConditionPathExists` on the
ready-flag, boot-time re-arm — all considered and rejected), and a post-mortem
rule.

**Why this matters for docs-writer specifically:** the post-mortem states a
forward RULE that this agent should enforce whenever asked to document a new
`.timer` unit or a change that arms one — the doc/PR must say whether the
payload sources the guard, uses a monotonic trigger (`OnBootSec=`/
`OnUnitActiveSec=`, immune by construction), or documents why a spurious
step-fire is harmless. If none of the three is true in what's being
documented, flag it rather than silently writing it up as done.

**How to apply:** when a task touches any `.timer`/`.service` pair or
`schedule_timer.sh`, read `docs/reference/scheduled-timers.md` in full first
(not just skim) — the non-fixes list exists specifically so a plausible-looking
"fix" isn't re-proposed and re-documented as new. CLAUDE.md carries only a
3-line pointer to this doc under "RM520N-GL Platform" — do not re-inline the
mechanism there.
