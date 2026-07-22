# Scheduled Reboot & Tower Lock Schedule (systemd timers)

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
(the directory is world-writable) but the entry never fired — a silent no-op
that showed a green success toast. `crond` being on `PATH` is the trap: the
binary's presence is not evidence a daemon consumes crontabs.

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
