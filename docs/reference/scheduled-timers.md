# Scheduled Reboot & Tower Lock Schedule (systemd timers)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> Two features let the user run something at a fixed time of day: **Scheduled
> Reboot** (reboot the modem on a weekly recurring schedule) and the **Tower
> Lock Schedule** (apply a cell/tower lock at a start time each day and clear
> it at an end time). Both used to write cron lines that **nothing on this
> device ever read** — so the UI reported success while nothing fired. This
> doc explains the replacement: runtime-generated systemd `OnCalendar` timers
> armed by root helpers, built on the shared `schedule_timer.sh` library.

The one platform fact behind all of this: **RM520N-GL ships a `crond` binary
but never runs it.** `which crond` finds `/usr/sbin/crond` (a BusyBox applet),
which makes it *look* available, but there is no systemd unit that starts it,
no boot symlink, and `/var/spool/cron/crontabs/` is empty. Any feature that
`printf`'d a line into `/var/spool/cron/crontabs/root` succeeded at *writing*
(the directory was world-writable at the time) but the entry never fired — a
silent no-op that showed a green success toast. `crond` being on `PATH` is the
trap: the binary's presence is not evidence a daemon consumes crontabs.

The fix mirrors the proven auto-update and Custom SIM Profile scenario-schedule
pattern: generate a systemd `.timer` unit at runtime whose `OnCalendar=` line
encodes the schedule, and let a paired oneshot `.service` do the work when it
fires. systemd's timer subsystem is always running, so unlike crond this
actually fires.

---

## Quick Reference

| Item | Scheduled Reboot | Tower Lock Schedule |
|------|------------------|---------------------|
| UI surface | System Settings → Scheduled Operations | `/cellular/tower-locking` → Schedule |
| CGI | `scripts/www/cgi-bin/quecmanager/system/settings.sh` (`save_scheduled_reboot`) | `scripts/www/cgi-bin/quecmanager/tower/schedule.sh` |
| Arm helper (root) | `scripts/usr/bin/qmanager_scheduled_reboot_arm` | `scripts/usr/bin/qmanager_tower_schedule_arm` |
| Timer unit(s) | `qmanager-scheduled-reboot.timer` (1) | `qmanager-tower-schedule-apply.timer` + `qmanager-tower-schedule-clear.timer` (pair) |
| Fire service(s) | `qmanager-scheduled-reboot.service` | `qmanager-tower-schedule-apply.service`, `qmanager-tower-schedule-clear.service` |
| Fire worker | `scripts/usr/bin/qmanager_scheduled_reboot` | (tower-lock apply/clear scripts) |
| Shared lib | `scripts/usr/lib/qmanager/schedule_timer.sh` | (same) |
| Sudoers grants | `scripts/etc/sudoers.d/qmanager` (two bare-path arm-helper lines) | (same file) |

Units install to `/lib/systemd/system/`; the boot symlink lives in
`/lib/systemd/system/timers.target.wants/`.

---

## The shared library: `schedule_timer.sh`

Both arm helpers `source` one small library that does two jobs and nothing
else — it is deliberately not a copy of the Connection Scenario schedule's
compiler:

| Function | Job |
|----------|-----|
| `_qm_validate_hhmm <value>` | Validate a time-of-day. Two gates in order: a **charset reject** (`case` pattern `*[!0-9:]*` — any byte outside `[0-9:]`, *including a newline*, fails) then a **shape check** (strict `HH:MM`). |
| `_qm_validate_days <csv>` | Validate a `0=Sun..6=Sat` comma mask. Charset reject `*[!0-9,]*`, then every comma-split token must be a single digit `0-6`. |
| `_qm_oncalendar_line <days_csv> <HH:MM>` | Render one `OnCalendar=<Dow[,Dow…]> HH:MM:00` line (numeric days → `Sun`/`Mon`/… names, de-duped). Prints **nothing** if the day list resolves to zero valid days, so a caller can treat empty output as "no schedule → tear down" rather than arming a config-error empty `OnCalendar=`. |

> ⚠️ WARNING: the charset gate is the newline-injection defense, and it must
> run **before** the shape check. Both time and day values reach the arm
> helpers through a `www-data`-reachable `sudo` call and are interpolated
> straight into a generated `.timer` unit. A value whose first line looks like
> `04:00` but carries a smuggled newline plus an extra `ExecStart=`/`OnCalendar=`
> directive on a second line would defeat an anchored `^…$` regex — the
> bracket-negation `case` pattern matches across the *whole* string (including
> the newline) and rejects it. `schedule_timer.sh` does **not** re-validate
> internally, so each helper must call the validators first; the header says so.

Why this library instead of reusing `scenario_mgr.sh`'s
`_scenario_generate_oncalendar_lines`: the scenario schedule solves a harder
problem (multi-block timeline with default-restore transitions across
midnight). Scheduled Reboot and Tower Lock each need only a single fixed
"day-mask + HH:MM, weekly recurring" trigger. Reusing the scenario compiler
would over-fit a one-line need — the two are intentionally separate.

---

## The arm helpers

Each helper is a sudo-reachable root script with two verbs:

```
sudo -n /usr/bin/qmanager_scheduled_reboot_arm install <HH:MM> <days_csv>
sudo -n /usr/bin/qmanager_scheduled_reboot_arm teardown

sudo -n /usr/bin/qmanager_tower_schedule_arm install <start HH:MM> <end HH:MM> <days_csv>
sudo -n /usr/bin/qmanager_tower_schedule_arm teardown
```

They both print a one-line JSON result and behave identically in structure;
the tower helper just manages **two** units (apply + clear) atomically instead
of one:

```json
{ "success": true, "armed": true,  "reason": "" }
{ "success": true, "armed": false, "reason": "no_schedule" }
{ "success": true, "armed": false, "reason": "unit_absent" }
{ "success": false, "error": "invalid_time", "detail": "time must be HH:MM" }
```

Load-bearing properties, all mirroring `qmanager_scenario_schedule_arm` /
`qmanager_auto_update_arm`:

- **Manual symlink, not `systemctl enable`.** The helper writes the unit to
  `/lib/systemd/system/` and hand-links it into
  `/lib/systemd/system/timers.target.wants/`. On this minimal systemd 244,
  `systemctl enable` writes into `/etc/systemd/system/` and `is-enabled` only
  reads `/etc`, but every other qmanager unit persists via `/lib` symlinks —
  using `enable` here would scatter this timer's enablement to a different
  place than the rest of the system. One source of truth wins.
- **`Persistent=false` is deliberate, not a default.** A missed window during
  downtime must **not** stack-fire the instant the device returns. For reboot
  that would reboot the box again right after it just booted; for tower lock a
  clear or apply would fire hours late and surprise the user. (`Persistent=true`
  is the "catch up on missed runs" flag — the opposite of what's wanted here.)
  > ⚠️ WARNING: **`Persistent=false` guards the downtime case only — it does
  > NOT guard the 1970 clock-step case.** `Persistent=` controls whether
  > systemd stamps and re-reads a last-trigger file across a *reboot*, so it
  > only matters for time the device was powered off. It says nothing about a
  > timer that was armed only seconds ago, on *this* boot, against a clock
  > that has not been set yet — which is exactly what happens on every RM520N
  > boot before the network sets the real time. That case blindsided
  > Scheduled Reboot on the systemd-timer migration and is guarded
  > worker-side instead; see [The 1970 boot window](#the-1970-boot-window)
  > below.
- **Empty schedule → teardown, not a broken unit.** If `_qm_oncalendar_line`
  returns empty (no resolvable day), the helper tears any existing timer down
  and reports `armed:false, reason:"no_schedule"` rather than writing a `.timer`
  with a zero `OnCalendar=` line (a systemd config error).
- **Missing-unit no-op.** If the target `.service` is absent (an OTA-upgraded
  device whose base predates this feature), the helper returns
  `{"success":true,"armed":false,"reason":"unit_absent"}` — a clean landing,
  not a hard error. The tower helper checks **both** services and refuses to
  arm just half the pair.
- **Atomic write + remount.** `/lib` is read-only-by-default UBIFS, so the
  helper does `mount -o remount,rw /` (idempotent) and writes each unit to a
  tmp file then `mv`s it over the target, so a concurrent `daemon-reload` never
  sees a half-written unit. On any arm failure the tower helper tears the whole
  pair down rather than leave it half-armed.
- **Arms the current boot too.** After writing the symlink it runs
  `systemctl start <timer>` so the schedule is live immediately, not only after
  the next reboot.

### The `armed` flag reaches the UI

The helper's `armed:true|false` is plumbed back through the CGI save response
(`settings.sh` / `tower/schedule.sh` read it from the arm JSON and re-emit it)
so the frontend toast can tell the truth. Before this, a schedule that failed
to arm still showed a green success. Now the UI can warn when a save persisted
but the timer did **not** arm (e.g. `reason:"unit_absent"` on an old base).

---

## The fire workers

An `OnCalendar` line encodes only **when** to fire, never a payload — so each
timer points at a fixed oneshot `.service` that does the work:

- **Scheduled Reboot:** `qmanager-scheduled-reboot.service` runs
  `qmanager_scheduled_reboot`, which has an **OTA-in-progress guard** — it
  checks `/tmp/qmanager_update.pid` via `pid_alive` and skips the reboot if an
  update worker is live, so a scheduled reboot can't interrupt a firmware
  update mid-flight.
- **Tower Lock Schedule:** the apply timer fires the tower-lock *apply* service
  at the start time; the clear timer fires the *clear* service at the end time.
  Two independent timers, one shared day mask.

All three `.service` units are `Type=oneshot` with **no `[Install]` section** —
they are only ever started by their timer, never boot-enabled directly.

---

## The 1970 boot window

**Short version:** the RM520N-GL has no clock battery, so every boot starts
in January 1970 and only becomes "now" about 24 seconds later, once the
network hands the modem the real time. Any systemd timer that's armed during
that ~24-second window — which is all of them, because timers arm before the
clock is set — gets tricked into firing once, immediately, for no reason
related to its actual schedule. This bit us for real: Scheduled Reboot's
payload is `reboot`, and rebooting resets the clock back to 1970, so the trap
re-arms itself and the modem loops every 30–60 seconds.

### Why the clock starts at 1970

There's no RTC (real-time clock) battery on this modem — the little
coin-cell-backed chip that keeps a laptop's or PC's clock ticking through a
power-off. `/dev/rtc0` is present but free-running with no persisted date, so
at boot the kernel's `hctosys=1` option seeds `CLOCK_REALTIME` (the
wall-clock time — "what time is it right now", as opposed to
`CLOCK_MONOTONIC`, which just counts seconds since boot and never jumps) from
whatever garbage `/dev/rtc0` currently holds. In practice that's the Unix
epoch: 1970-01-01 00:00:00.

Stock Quectel firmware ships `ql_time_daemon`, a boot-enabled process holding
`CAP_SYS_TIME` (the Linux capability that lets a non-root-shell process set
the system clock). It gets the real date from the **cellular network** — the
same NITZ-style time info (Network Identity and Time Zone, a signal the
tower sends during registration) a phone uses to set its clock without you
touching a setting. That means it **requires a registered SIM**: no SIM, no
network time source, and the clock is stuck at 1970 forever. This is also
why the original bug reporter's device was rock-solid *without* a SIM
inserted — the clock literally never moved, so the trap this section
describes never sprang.

When `ql_time_daemon` steps the clock, it writes
`/tmp/ql_time_set_ready.flag` (content like `RTC:2026-08-01 10:29:54`) as a
signal for anything that wants to know the clock is now sane. QManager
cannot reorder or suppress this daemon — it is stock firmware.

### The measured boot timeline

Probing a live device gives concrete numbers. These are measured, not
estimated — see [End-to-end verification on hardware](#end-to-end-verification-on-hardware)
for the run that produced them:

| Monotonic time (seconds since boot) | Wall clock at that moment | Event |
|---|---|---|
| ~6.5s | **1970** | `timers.target` reached — every `.timer` symlinked into `/lib/systemd/system/timers.target.wants/` is now armed |
| ~23–24s | **1970** | **Misfire #1** — the armed timer fires while the clock is *still* 1970 |
| ~24s | 1970 → real date | `ql_time_daemon` steps `CLOCK_REALTIME`; `/tmp/ql_time_set_ready.flag` is written |
| ~29–30s | real date | **Misfire #2** — the timer fires *again*, immediately after the step |

Every QManager timer is therefore armed **~17 seconds before** the clock
becomes trustworthy. That gap is the whole bug.

### Why systemd fires the timer at the step, not later

This is the mechanistic core, and it's a real systemd 244 behavior, not a
QManager-specific quirk. When a timer is armed, systemd's
`timer_enter_waiting()` (in `src/core/timer.c`) computes the next fire time
("base") for an `OnCalendar=` rule from the unit's
`inactive_exit_timestamp.realtime` — i.e. wall-clock time, and on this device
that's a 1970 timestamp. systemd has a clamp for a base computed to be in the
*future* (a defensive check against clocks that are wildly fast-forward), but
**no equivalent clamp for a base in the past**. A 1970-based "next Tuesday at
04:00" resolves to a date decades ago — which systemd treats as "already
due."

The timer is armed against the kernel using a `timerfd` (a file descriptor
that becomes readable when a deadline passes — Linux's way of turning "wake
me up at time X" into something `select`/`poll` can wait on) in
`TFD_TIMER_ABSTIME` mode (absolute deadline, not "N seconds from now")
**without** `TFD_TIMER_CANCEL_ON_SET` — the flag that would make the
timerfd cancel and reset when the system clock jumps. Without that flag, the
moment `ql_time_daemon` steps `CLOCK_REALTIME` forward by 56 years in one
call, the kernel sees the (long-past) absolute deadline has been crossed and
fires the timerfd immediately. systemd sees the trigger and fires the unit
— once, at whatever wall-clock minute the step happened to land on, with no
relation to the actual `OnCalendar=` schedule.

### It's a bounded misfire, and systemd self-heals — the loop is our bug, not systemd's

This is the detail that matters most for judging severity: once the clock is
sane, systemd stamps `last_trigger` with the *real*, post-step date, and the
next scheduled-time computation is correct. **An armed timer firing at boot
is not, by itself, a disaster** — it becomes an infinite loop **only because
Scheduled Reboot's payload is `reboot`**. Rebooting resets `CLOCK_REALTIME`
back to 1970, which re-arms the exact same trap on the next boot. Any other
payload (an AT command, a config write) just runs early and harmlessly, and
then the schedule behaves correctly forever after.

> **Correction from hardware testing: it is TWO fires per boot, not one.**
> This doc originally said "one spurious fire per boot," reasoning from
> systemd's source. Measuring it on a real device showed **two**, and they
> have different causes:
>
> 1. **At ~23s, while the clock still reads 1970.** The calendar base is a
>    near-epoch timestamp, so the computed "next 04:00" resolves to
>    1970-01-01 04:00 — already past even by 1970 standards — and the timer
>    fires as soon as it is armed.
> 2. **At ~29s, just after the step.** Now the base is the boot's 1970
>    timestamp, so the next elapse computes to a 1970 date; the step to the
>    real date puts that deadline ~56 years in the past, and the timerfd
>    expires immediately all over again.
>
> This does not change the fix — the guard denies both, for different
> reasons (fire #1 fails the year check, fire #2 fails the uptime check).
> It does mean **any reasoning that assumes a single fire is wrong**, which
> matters for any future payload judged "harmless if it runs once."

### Exposure: all four timer families sit in the window

| Timer | Generator | Persistent | Payload on misfire | Severity |
|---|---|---|---|---|
| `qmanager-scheduled-reboot.timer` | `qmanager_scheduled_reboot_arm` via `schedule_timer.sh` | false | `reboot` → **boot loop** | CRITICAL |
| `qmanager-tower-schedule-apply.timer` / `-clear.timer` | `qmanager_tower_schedule_arm` via `schedule_timer.sh` | false | `AT+QNWLOCK` apply/unlock at wrong time, ~24s into boot | Medium |
| `qmanager-scenario-schedule.timer` | `qmanager_scenario_schedule_arm` (scenario_mgr.sh jq compiler) | false | Re-resolves scenario state at wrong time (post-step clock, so the resulting state itself is correct) | Low-Medium |
| `qmanager-auto-update.timer` | static file, armed by `qmanager_auto_update_arm` / installer | **true** | One spurious daily update check per boot; if an update exists, an unattended install+reboot triggered by *boot*, not schedule. `Persistent=true` also independently stack-fires at boot | Medium |

Only users with the feature enabled are exposed (`sched_reboot_enabled` and
auto-update both seed to 0). The first boot after an OTA update is exactly a
boot with freshly-written timers and a pre-step clock — the installer
re-arms every schedule from saved config on every install/OTA.

### The guard: making the one spurious fire harmless

The fix does not try to prevent the misfire (nothing on our side can — it's
a kernel/systemd interaction with a daemon we don't control). Instead, each
fire *worker* script — the thing the timer actually runs — checks a guard
before doing any work: `_qm_timer_fire_allowed` in `schedule_timer.sh`. A
fire is **allowed** only if:

1. The wall-clock year parses and is ≥ 2025, **and**
2. Either uptime is ≥ 300 seconds (the real clock step happens at ~24s, so
   nothing legitimate needs to fire that early), **or** the worker knows its
   own schedule minute and the current time is within ±10 minutes of it —
   this keeps a genuine fire that happens to land shortly after a manual
   reboot working (e.g. user reboots at 03:58, schedule says 04:00).

A denied fire logs a warning and exits 0 (a clean, successful no-op — never
an error exit) so systemd doesn't retry or flag the unit as failed.

| Worker | Guard call | Schedule-minute source |
|---|---|---|
| `qmanager_scheduled_reboot` | `_qm_timer_fire_allowed "$sched_time"` | `qm_config_get settings sched_reboot_time ""` |
| `qmanager_tower_schedule apply` | `_qm_timer_fire_allowed "$start"` | `jq -r '.schedule.start_time // empty' /etc/qmanager/tower_lock.json` |
| `qmanager_tower_schedule clear` | `_qm_timer_fire_allowed "$end"` | `jq -r '.schedule.end_time // empty'` (same file) |
| `qmanager_scenario_schedule` | `_qm_timer_fire_allowed ""` at lines 54–60 (a multi-block timeline has no single schedule minute to pass) | — |
| `qmanager_auto_update` | `_qm_timer_fire_allowed ""` (`RandomizedDelaySec=3h` means no fixed minute) | — |

> ℹ️ NOTE: **What the empty-string argument means.** Passing `""` is not "skip
> the guard" — it says *"I have no single schedule minute to compare against."*
> Condition 1 (clock-sane) still applies in full, and condition 2 collapses to
> its uptime-only branch, because the ±10-minute grace has nothing to be within
> ten minutes *of*. The practical effect is a **stricter** guard, not a looser
> one: an empty-argument worker will not fire at all until uptime ≥ 300 s, so
> both boot-window misfires (~23 s and ~29 s) are rejected outright. A denied
> fire is a skip — `exit 0`, no teardown — so the armed `.timer` is untouched and
> its next real elapse proceeds normally. This is what keeps the Custom SIM
> Profiles hero's 24-hour schedule ribbon honest: it draws what the device will
> actually do, and the device does not act during the boot window.

`QM_TIMER_GUARD_BYPASS=1` skips the guard entirely — it exists only for
manual invocation and on-device testing and must never be set in a
production unit file.

### Explicit non-fixes — do not re-try these

Each of these looks like a plausible fix and was considered and rejected.
Documenting them here so nobody re-discovers and re-implements one later:

- **`Persistent=false` does not guard this.** See the warning above — it
  only governs the across-reboot catch-up stamp, not a same-boot pre-clock
  fire.
- **`Persistent=true` is strictly worse, not better.** Persistent catch-up
  is *implemented by* firing against a past-due base — it's the same
  mechanism that causes the bug, deliberately invoked. Turning it on
  anywhere it isn't already would add a second reason to fire early, not
  remove the first.
- **A day-of-week mask does not help.** 1970-01-01 was a Thursday. Any
  `OnCalendar=` day restriction still resolves to *some* day within the next
  1970 week, so the past-base problem is unchanged — it just changes which
  Thursday-adjacent date the bogus "next fire" lands on.
- **systemd's build-epoch floor does not help.** Some systemd builds clamp
  timestamps to no earlier than their own compile date (roughly 2020 here).
  That still leaves the computed base years in the past relative to the real
  date, so the timer still reads as "already due" and still fires
  immediately at the step.
- **`After=time-sync.target` is inert on this device.** That ordering
  dependency exists to delay units until `systemd-timedaemon`/NTP confirms
  the clock is synced — but RM520N doesn't ship `systemd-time-wait-sync`, so
  the target is never reached and the ordering does nothing.
- **Monotonic timers are immune, but that's not a fix for these four.**
  `OnBootSec=`/`OnUnitActiveSec=` timers key off `CLOCK_MONOTONIC` (seconds
  since boot, which never jumps), so they're never fooled by the clock step.
  That's genuinely useful — but Scheduled Reboot, Tower Lock, and the
  scenario schedule all need wall-clock semantics ("at 04:00 every day"),
  which is exactly what `OnCalendar=` is for. It's the right immunity for a
  different kind of timer, not a substitute here.
- **`ConditionPathExists=/tmp/ql_time_set_ready.flag` on the `.service`
  units — rejected as racy by construction.** The flag is written **at**
  the clock step — the same instant the spurious fire happens. By the time
  systemd evaluates the `Condition`, the flag has almost certainly already
  been written, so the condition passes and guards nothing. A Condition that
  actually mattered (skip while the clock is still 1970) would need to run
  *before* the step, but the service's `ExecStart` only runs *after*
  systemd decides to fire it — which is already after the step. This is
  exactly why the real guard checks **uptime + schedule-minute match**
  instead of the epoch alone: an epoch-only check loses the same race.
- **A boot-time re-arm oneshot (e.g. from `qmanager_setup`, waiting for the
  clock to become sane before arming timers) — rejected as the primary
  fix.** It's structurally appealing — it would remove the exposure for all
  four families at once — but: `qmanager_setup` runs *before* the step, so
  it would need a new background waiter loop in the boot-critical path; and
  a device that never gets a SIM never gets a sane clock, meaning Scheduled
  Reboot and auto-update would **silently never arm** on such a device — a
  new silent no-op of exactly the kind this subsystem was just cured of
  (see the crond history earlier in this doc). The worker-side guard also
  defends against causes other than the clock step (a manual
  `systemctl start`, a `Persistent=true` catch-up), which a boot-time re-arm
  would not.

---

## End-to-end verification on hardware

Run on the live RM520N-GL test unit on **2026-08-02**, against the guarded
worker. Two independent boots, identical results.

### Method

Reproducing the loop directly with the *unguarded* worker was rejected: a
real boot loop is only escapable inside a ~20-second SSH window per cycle.
Instead the run used a **control probe** — a second `.timer` carrying the
byte-identical `OnCalendar=` line as `qmanager-scheduled-reboot.timer`, but
whose payload only appends a line to a log. The probe proves whether the
misfire happens; the guarded worker proves whether it is survived. Neither
can mask the other.

A **circuit breaker** oneshot (`Before=timers.target`, so it runs at ~6s —
well ahead of the ~24s step) counted boots and, from boot 2 onward, would
have replaced the reboot worker with a no-op stub. That bounded the worst
case at exactly one unexpected reboot instead of an unbounded loop. It never
tripped.

Both timers were armed at `04:00` daily while the wall clock read `12:07`,
so `systemctl list-timers` showed the next legitimate elapse **15 hours
away**. Any fire observed at boot therefore could not be a real scheduled
run.

### Result

| Check | Boot 1 | Boot 2 |
|---|---|---|
| Control probe fired at 1970 | `PROBE_FIRE date=1970-01-02T11:30:28 uptime=23` | `PROBE_FIRE date=1970-01-02T11:33:21 uptime=24` |
| Control probe fired again post-step | `PROBE_FIRE date=2026-08-02T12:08:13 uptime=30` | `PROBE_FIRE date=2026-08-02T12:11:05 uptime=29` |
| `qmanager-scheduled-reboot.service` ran | yes, PID 1383 | yes, PID 1257 |
| Guard verdict | `Scheduled reboot skipped: fire outside schedule window (clock-step guard, issue #9)` | same |
| Service exit | `status=0/SUCCESS` | `status=0/SUCCESS` |
| Device rebooted? | **no** | **no** |
| Boot counter after run | `1` | `1` |

The boot counter staying at `1` is the direct proof of no loop: the breaker
increments it once per boot, and a second increment never happened.

### What this settles

- **The misfire is real on this hardware, not just in systemd's source.**
  A timer whose only legitimate elapse was 15 hours away fired twice within
  30 seconds of boot, on two consecutive boots. That was previously the one
  inferred link in the chain.
- **The guard holds in production form**, not just in unit tests: the real
  `.timer` → real `.service` → real worker → real `qm_config_get` path
  denied the fire and exited 0.
- **A wall-clock/epoch guard would NOT have worked.** This is the sharpest
  finding. The worker's guard evaluated at wall clock `12:08:15`, uptime
  ~32s — the clock was *already correct* by then. Any "refuse to act if the
  epoch looks implausibly small" check would have passed cleanly and
  rebooted the device. The `/proc/uptime` check is what actually stopped it.
  An earlier draft of this fix proposed exactly that epoch-floor check; it
  would have shipped as protection that never protects.

### What it does not settle

Whether the original reporter's device failed for *this* reason. This run
proves the mechanism exists and that the guard defeats it; it does not
prove the reporter had `sched_reboot_enabled: 1`. See the honesty note
below.

---

## Post-mortem: "making a dead feature live" inherits no field-testing

Scheduled Reboot was a **silent no-op for its entire life** before this
fix's parent change (commit `9bbd670`): it wrote lines into a `crond`
crontab that nothing on this device ever reads (see the crond section
earlier in this doc). That migration replaced the dead cron write with a
real, running systemd timer — the feature *worked*, correctly, for the
first time. And the very first time it actually fired, it walked straight
into this platform trap, because nothing had ever exercised the "timer
actually fires" code path on real hardware before.

**The transferable lesson:** turning a dead feature into a live one gives
you none of the field-testing the dead version appeared to have racked up.
A feature that's been "in production" for months with zero complaints and a
green success toast on every save can still be completely unexercised at
the one moment that matters — the first real fire.

**The forward rule.** Any new `.timer` unit, or any change that arms one,
must state — in its plan or PR — how its payload behaves when the timer is
armed at 1970 and fires once at the clock step. One of the following must be
true:

1. The payload sources `_qm_timer_fire_allowed` from `schedule_timer.sh`
   before doing its work, or
2. The timer uses a monotonic trigger (`OnBootSec=` / `OnUnitActiveSec=`),
   which is immune to this by construction, or
3. The plan explicitly documents why a spurious step-fire is harmless for
   this specific payload (idempotent, side-effect-free, or already guarded
   another way).

If none of the three apply, the timer is not done.

---

## Honesty note: what this fix does and doesn't prove

The clock-step mechanism above is proven three ways: from systemd 244's
source (`timer_enter_waiting()` in `src/core/timer.c`, the `timerfd`
`TFD_TIMER_ABSTIME` behavior); from a live measured boot timeline on the
test device (`timers.target` at ~6.5s, clock step at ~24s); and — since
2026-08-02 — from a direct observation of an armed timer firing twice
within 30 seconds of boot when its next legitimate elapse was 15 hours
away, reproduced across two boots. See
[End-to-end verification on hardware](#end-to-end-verification-on-hardware).
That much is fact, not inference.

What is **not** confirmed is causation on the original bug reporter's
specific device. The verification run above armed Scheduled Reboot
deliberately; it does not tell us whether the reporter had it enabled.
Separately, journald is disabled device-wide on this platform, so the
reporter could not have observed the spurious fire in logs even if they'd
known to look. There is also a rival hypothesis that has not been excluded:
a modem-side subsystem restart (SSR) triggered at SIM attach could produce a
similar 30–60 second, SIM-correlated reboot signature with fewer
assumptions.

The single cheapest way to close this gap is to ask the reporter for:

```sh
grep sched_reboot /etc/qmanager/qmanager.conf
ls -l /lib/systemd/system/timers.target.wants/
```

If `sched_reboot_enabled` is `1` and `qmanager-scheduled-reboot.timer` is
symlinked there, causation is settled. If it is `0`, this diagnosis does not
explain their loop and SSR is the next thing to investigate.

The fix stands regardless of which explanation matches the reporter's
device: the clock-step mechanism is real and proven on this platform
independent of any one report, and a reboot worker that runs unconditionally
on any spurious start is an independent defect worth closing on its own
merits. If a reported reboot loop persists after this fix ships, the next
step is to investigate SSR — don't assume this closed every case until the
reporter confirms.

---

## Installer / OTA behavior

- `install_rm520n.sh` ships the three `.service` units and the two arm helpers,
  and **excludes the timers from the boot-symlink sweep** (they are armed on
  demand by the helpers, not enabled at install).
- `enable_services()` **re-arms config-driven on every OTA**: it reads the saved
  Scheduled Reboot / Tower Lock schedule from config and calls the arm helpers,
  so an upgrade that wipes and re-lays units re-establishes any active schedule.
- `uninstall_rm520n.sh` tears down all three timers (stop + remove unit + remove
  wants-symlink).
- `qmanager_update` runs `scrub_legacy_cron()` on every OTA path, stripping the
  dead legacy cron markers left in `/var/spool/cron/crontabs/root` by the old
  no-op code so upgraded devices don't carry stale entries.
- `uninstall_rm520n.sh` Step 11 scrubs the same file directly instead of shelling
  out to `crontab`. On this device `crontab -l` errors outright (`can't open
  'root'`), so the old `crontab -l | grep -v qmanager | crontab -` pipeline never
  matched anything.

---

## `/var/spool/cron/crontabs` is still created, and still re-tightened

Nothing reads this directory on RM520N-GL. It is retained for exactly one
reason: it gives `scrub_legacy_cron()` (and the uninstaller's Step 11) a stable
path to scrub, rather than having them guess.

`qmanager_setup` creates it with `install -d -o root -g root -m 0755` on **every
boot**. It previously shipped `chmod 777` — and this is a re-tighten, not a
removal, because of where the directory lives:

- Verified live, it was `drwxrwxrwx root:root`, empty, on **persistent flash**
  (`ubi0:rootfs` — *not* tmpfs), created by QManager's own installer on install
  day. A reboot does not reset it.
- So simply deleting the `chmod 777` would have left every already-fielded
  device world-writable forever: nothing else would ever visit the path again.
  `install -d` re-applies owner and mode on every run, which is what makes
  fielded devices self-heal. This is the same reasoning as the "Directory
  creation rule: `install -d`, never `mkdir -p`" section in
  [qmanager-independence.md](qmanager-independence.md).
- The risk is latent rather than live: with no `crond` running, a world-writable
  spool executes nothing today. But `scrub_legacy_cron()` writes a predictable
  `${cron_file}.tmp` inside it, and any future release — or a manually started
  `crond` — that read root's crontab would run attacker-planted content as root.

> ⚠️ WARNING: **Timing.** `qmanager_setup` is a boot-time oneshot and is *not*
> invoked by `qmanager_update` mid-OTA. The re-tighten therefore lands on the
> **next reboot after** the update, not during it.

Also verified live on the device: no `crond` process, no cron systemd unit, no
`/etc/cron*`, and no `atd`. The BusyBox `crond`/`crontab` binaries exist and
nothing launches them.

## `scrub_legacy_cron()`: the `grep -v` exit-1 bug

`grep` exits **1** when it selects no lines. For `grep -v PATTERN` that means
*every* line matched the pattern — i.e. root's crontab consisted **entirely** of
QManager markers, which is precisely the case the scrub exists for.

The old code was:

```sh
grep -vE 'qmanager_…' "$cron_file" > "${cron_file}.tmp" 2>/dev/null \
    && mv "${cron_file}.tmp" "$cron_file"
log "Scrubbed legacy QManager cron markers from $cron_file"
```

The `&&` short-circuited on that exit 1, so the `mv` never ran, every marker
stayed in place — and the unconditional `log` still reported success.

Both scrubs (`qmanager_update`'s `scrub_legacy_cron()` and the uninstaller's
Step 11) now capture the exit status and treat **0 and 1 alike**; only `>= 2` is
a real `grep` error. They also `chmod 600` the temp file before the rename
(crontabs are conventionally `0600 root:root`, and the `>` redirect creates the
temp with the ambient umask), and log success **only if the `mv` actually
succeeded**.

---

## Timezone interaction

systemd evaluates `OnCalendar=` in the **system timezone**. A running timer
does not re-read the zone live; it picks up a zone change on the next
`systemctl daemon-reload` or reboot. Practical guidance: set the timezone
first, then configure these schedules, so the trigger times mean what the user
expects. See [timezone.md](timezone.md#schedules-adopt-the-new-zone-on-daemon-reload-or-reboot).

---

## Related

- [sim-profiles.md](sim-profiles.md#scenario-schedule-windows-systemd-timer-not-crond) — the Connection Scenario schedule, the richer sibling that arms a multi-block timer via `qmanager_scenario_schedule_arm`; the same manual-symlink + `Persistent=false` pattern these helpers copy.
- [qmanager-independence.md](qmanager-independence.md) — the auto-update timer (`qmanager_auto_update_arm`), the original runtime-armed-timer pattern, plus the live-probe evidence that RM520N runs no `crond`.
- [timezone.md](timezone.md) — why `crond` is dead on this platform and how the clock/zone actually work.
