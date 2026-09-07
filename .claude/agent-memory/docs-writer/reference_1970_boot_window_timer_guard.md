---
name: reference_1970_boot_window_timer_guard
description: Any new systemd .timer on RM520N must address the 1970 clock-step spurious fire — full mechanism, the AND-composite guard, and the After=opt.mount trap live in scheduled-timers.md
type: reference
---

RM520N-GL has no battery RTC. Every boot starts at CLOCK_REALTIME=1970 until
stock `ql_time_daemon` steps it to the real date ~24s in (network-sourced,
needs a registered SIM — no SIM means 1970 forever). systemd 244 arms
`OnCalendar=` timers against that 1970 base at `timers.target` (~6s monotonic)
and has no past-base clamp, so every armed timer misfires TWICE per boot
(~23s at 1970, ~29s just after the step). It only becomes a loop if the payload
is `reboot`. Issue #9.

**Second pass, 2026-09-08 — the first guard did NOT close it.** The composite
was `clock_sane AND (boot_settled OR now_matches(sched))`; the OR made uptime an
escape hatch, and a misfire landing within the ±10-minute grace of the user's own
schedule sustains the loop forever. It is now
`clock_sane AND boot_settled AND (sched empty OR now_matches) AND (no days OR today in days)`.
Full mechanism, the guard contract, the skip trace, the two findings and the
accepted residuals are in `docs/reference/scheduled-timers.md`.

**The two traps a future doc/plan will otherwise walk into:**

1. **Never order these timers `After=opt.mount`.** `qm_config_get` uses `jq`,
   `/usr/bin/jq` symlinks to `/opt/bin/jq`, and `opt.mount` activation on this
   platform is *bimodal* (~4s or ~24-30s). On a late boot the schedule read
   returns its DEFAULT, which is what accidentally masked issue #9 on some
   devices — "my hardware died" on one unit and not another, same firmware.
   Ordering after `/opt` repairs the read and thereby ARMS the loop path.
   Nothing in the fire-guard path may depend on `jq` or `/opt`.
2. **Zero-padded HH:MM arithmetic must go through `awk`, never `$(( ))`.**
   `$((08*60+09))` is not merely wrong — verified on hardware, it raises an
   arithmetic syntax error that ABORTS THE WHOLE SCRIPT in BusyBox ash. In a
   guard, that means no verdict at all. Validate the `awk` result as numeric
   afterwards too: empty operands make `$(( ))` compute 0, i.e. "exact match".

**Why this matters for docs-writer specifically:** the post-mortem states a
forward RULE to enforce whenever documenting a new `.timer` or a change that
arms one — the doc/PR must say whether the payload sources the guard, uses a
monotonic trigger (`OnBootSec=`/`OnUnitActiveSec=`, immune by construction), or
documents why a spurious step-fire is harmless. `qmanager-dpi-ensure.timer` is
the monotonic case and is named in the doc precisely so an inventory of "all six
timers" balances.

**How to apply:** when a task touches any `.timer`/`.service` pair or
`schedule_timer.sh`, read `docs/reference/scheduled-timers.md` in full first —
the non-fixes list exists so a plausible-looking "fix" isn't re-proposed and
re-documented as new. CLAUDE.md carries only a short pointer; do not re-inline
the mechanism there. See also [[reference_crash_log_has_three_readers]].
