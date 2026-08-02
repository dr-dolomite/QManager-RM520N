# Issue #9 — Clock-Step Timer Fix (Boot Loop After 0.1.12 → 0.1.13)

**Branch:** development · **Version:** v0.1.14-draft · **Tier:** 4
**Status:** Plan approved for execution. Builders execute tasks verbatim; do not re-litigate the root cause.

---

## 1. Background (settled — do not re-investigate)

RM520N-GL has **no battery-backed RTC**. Every boot, CLOCK_REALTIME starts at 1970-01-01
(`hctosys=1` seeds it from a free-running /dev/rtc0). Stock Quectel `ql_time_daemon`
(boot-enabled, CAP_SYS_TIME, sources time from the **cellular network**, so it needs a
registered SIM) steps the clock 1970 → real time at ~boot+24s and writes
`/tmp/ql_time_set_ready.flag` (content like `RTC:2026-08-01 10:29:54`). We cannot reorder
or suppress it.

Measured boot timeline: `timers.target` is reached at ~6.4s monotonic — **~17s before the
clock step**. Every `.timer` symlinked into `/lib/systemd/system/timers.target.wants/` is
therefore armed against a 1970 clock. systemd 244's `timer_enter_waiting()`
(src/core/timer.c) computes the OnCalendar base from the unit's 1970
`inactive_exit_timestamp.realtime`; it clamps a base in the *future* but has **no guard
for a base in the past**, and the armed timerfd uses `TFD_TIMER_ABSTIME` without
`TFD_TIMER_CANCEL_ON_SET` — so when the clock steps past the (1970-computed) absolute
deadline, the timer **fires immediately**, once, at ~boot+24s at an arbitrary wall minute.

After that one misfire systemd self-heals (`last_trigger` is stamped with the real date;
the next recompute is correct). It becomes an infinite loop **only** when the payload is
`reboot`: reboot resets the clock to 1970 and re-arms the trap. That is issue #9: with a
SIM installed the device reboots every 30–60s whenever the user has Scheduled Reboot
enabled; with no SIM the clock never steps, the timer never fires, and the device is
stable — exactly the reporter's control experiment.

**Facts builders must NOT "fix" differently (all verified — see §10 for details):**
- `Persistent=false` does NOT guard this (it only controls the across-reboot stamp file).
- `Persistent=true` is strictly worse (catch-up is *implemented by* the past-base fire).
- Day-of-week masks don't help (1970-01-01 was a Thursday; any mask resolves within days).
- systemd's build epoch floor doesn't help (lifts base to ~2020, still years past → same fire).
- `After=time-sync.target` is inert on this device (systemd-time-wait-sync not installed).
- Monotonic timers (`OnBootSec=`/`OnUnitActiveSec=`) are immune (CLOCK_MONOTONIC branch).

### Exposure (all four timer families land in the 1970 window)

| Timer | Generator | Persistent | Payload on misfire | Severity |
|---|---|---|---|---|
| `qmanager-scheduled-reboot.timer` | `qmanager_scheduled_reboot_arm` via `schedule_timer.sh` | false | `reboot` → **boot loop** | CRITICAL |
| `qmanager-tower-schedule-apply.timer` / `-clear.timer` | `qmanager_tower_schedule_arm` via `schedule_timer.sh` | false | AT+QNWLOCK apply/unlock at wrong time, ~24s into boot | Medium |
| `qmanager-scenario-schedule.timer` | `qmanager_scenario_schedule_arm` (scenario_mgr.sh jq compiler) | false | Re-resolves scenario state at wrong time (post-step clock, so state itself is correct) | Low-Medium |
| `qmanager-auto-update.timer` | static file, armed by `qmanager_auto_update_arm` / installer | **true** | One spurious daily update check per boot; if an update exists, an unattended install+reboot triggered by *boot*, not schedule. Persistent=true ALSO stack-fires at boot. | Medium |

Only users with the feature enabled are exposed (`sched_reboot_enabled` seeds to 0;
auto-update seeds to 0). The first boot after an OTA is *exactly* a boot with
freshly-written timers and a pre-step clock (installer re-arms from config on every
install/OTA, `install_rm520n.sh` `enable_services()` ~:2090–2160).

---

## 2. Fix design

**Chosen: (a) worker-side fire guards + (c) one shared guard primitive in
`schedule_timer.sh`, applied to all four worker scripts. No unit-file Condition, no
boot-time re-arm.**

Rationale — the key insight is that systemd misfires **once per boot and then
self-heals**. We do not need to prevent the fire; we need to make the one spurious fire
harmless. A worker-side guard does that regardless of cause (clock step, Persistent
catch-up, manual `systemctl start`, or causes not yet identified — including the
unexcluded rival hypotheses in §9).

Why the alternatives were rejected:

- **(b) `ConditionPathExists=/tmp/ql_time_set_ready.flag` on the .service units —
  REJECTED.** The flag is written *at* the clock step, which is the same instant the
  timer fires; by the time systemd evaluates the Condition the flag almost certainly
  exists, so the Condition passes and guards nothing. Worse, the guard that *would*
  matter (skip when clock is still 1970) is unnecessary for the same race reason: the
  service's ExecStart runs *after* the step, so a naive epoch check in the worker passes
  too. This is why the guard below keys on **uptime + schedule-minute match**, not on
  the epoch alone. Adding a racy Condition would give false confidence; document
  instead (§7).
- **(d) Boot-time re-arm after clock sanity (e.g. from `qmanager_setup`) — REJECTED as
  primary fix.** It is structurally attractive (removes the exposure for all four
  families at once) but: (1) `qmanager_setup` runs *before* the step, so it would need a
  background waiter loop on the flag file — new boot-time complexity in the critical
  path; (2) a device that never gets a SIM never gets a sane clock, so timers would
  silently never arm — Scheduled Reboot and auto-update dead with no UI indication, a
  new silent-no-op of exactly the kind this subsystem was just cured of; (3) it defends
  only against the clock-step cause, whereas the worker guard defends against any
  spurious start. Not worth it when the misfire is once-per-boot and the guard makes it
  a logged no-op.
- **Changing `Persistent=true` on the auto-update timer — NOT changed.** Its catch-up
  semantics are genuinely wanted for a daily update check, and after the worker guard a
  boot-time catch-up/step fire becomes a logged skip; the next legitimate daily elapse
  is computed from the post-step clock and lands within 24h on an always-on device. See
  Task B4.

### 2.1 Guard semantics (the contract builders implement)

A timer fire is **allowed** iff:

1. The wall-clock year parses and is ≥ 2025 (`_qm_clock_sane`); AND
2. EITHER uptime ≥ 300s (`_qm_boot_settled` — no spurious fire can occur that late;
   the step is at ~24s), OR the worker has a known schedule minute and the current
   HH:MM is within ±10 minutes of it (`_qm_now_matches_hhmm`) — this keeps a
   *legitimate* fire that happens to land shortly after a manual reboot (user reboots
   03:58, schedule 04:00) working.

Deny = log via `qlog_warn` and `exit 0` (clean skip, unit succeeds — mirrors the
existing OTA-interlock skip in `qmanager_scheduled_reboot`). Never `exit 1`.

Per-family policy:

| Worker | Guard call | Schedule minute source |
|---|---|---|
| `qmanager_scheduled_reboot` | `_qm_timer_fire_allowed "$sched_time"` | `qm_config_get settings sched_reboot_time ""` |
| `qmanager_tower_schedule apply` | `_qm_timer_fire_allowed "$start"` | `jq -r '.schedule.start_time // empty' /etc/qmanager/tower_lock.json` |
| `qmanager_tower_schedule clear` | `_qm_timer_fire_allowed "$end"` | `jq -r '.schedule.end_time // empty'` (same file) |
| `qmanager_scenario_schedule` | `_qm_timer_fire_allowed ""` (uptime-only; multi-block timeline has no single minute) | — |
| `qmanager_auto_update` | `_qm_timer_fire_allowed ""` (RandomizedDelaySec=3h means no fixed minute) | — |

Notes:
- Passing `""` degrades gracefully to: deny while clock insane or uptime < 300s.
- If the schedule-minute lookup fails (missing config/jq error), pass `""` — the
  uptime-only guard still holds and a legit fire ≥300s uptime still passes.
- `QM_TIMER_GUARD_BYPASS=1` env override skips the whole guard — for manual invocation
  and on-device testing only (documented as such in the function header).
- No new config keys → **no config migration needed** (`qm_config_init` limitation is
  moot). Thresholds are constants in the library, overridable via env for tests.

### 2.2 Failure-mode analysis of the guard itself (safety)

The guard can only **skip** work; it can never cause a reboot or AT command. Worst-case
bug directions:
- Guard wrongly denies → a scheduled reboot is skipped once, with a `qlog_warn` line in
  `/tmp/qmanager.log` + BusyBox syslog. The schedule fires next window. Recoverable, visible.
- Guard wrongly allows → behavior identical to today (pre-fix). No regression possible.

This asymmetry is why the worker-side guard is the right Tier-4 shape for a reboot path.

---

## 3. File-by-file tasks

Ordering: **Task A first** (everything sources it). B1–B4 are independent of each other
(parallelizable) but depend on A. C, D, E are independent of B and of each other. TDD:
Task A includes its test file; write the tests before the implementation.

### Task A — Guard primitives in `scripts/usr/lib/qmanager/schedule_timer.sh` (+ tests)

Append four functions to `schedule_timer.sh` (it already ships to
`/usr/lib/qmanager/` via the installer's `install_dir_flat` lib sweep at
`install_rm520n.sh:1112` — **no installer change needed**). Update the file header:
it currently says "Sourced by root helpers only"; amend to "Sourced by the arm helpers
(validation/generation) AND by the fire workers (fire guard)".

Implementation requirements (BusyBox/POSIX hazards are load-bearing):

```sh
# --- Fire guard (issue #9: 1970 clock-step spurious fire) --------------------
# RM520N has no battery RTC: every boot starts at 1970 and ql_time_daemon steps
# the clock ~24s in (needs a registered SIM). systemd 244 fires every armed
# OnCalendar timer ONCE on that step (past-base + TFD_TIMER_ABSTIME). Workers
# call _qm_timer_fire_allowed before doing any work; a deny is a clean skip.
# Test/bypass env: QM_TIMER_GUARD_BYPASS=1, QM_TEST_YEAR, QM_TEST_UPTIME,
# QM_TEST_NOW_HHMM (test-only; never set in production units).

_qm_clock_sane()      # 0 if year >= 2025; non-numeric year => 1 (deny, log-safe)
_qm_boot_settled()    # 0 if uptime secs >= ${QM_TIMER_SETTLE_SECS:-300}
_qm_now_matches_hhmm() # $1=HH:MM, $2=tolerance-min (default 10); 0 if |now-sched| <= tol modulo 1440
_qm_timer_fire_allowed() # $1=HH:MM or ""; composite per §2.1; honors QM_TIMER_GUARD_BYPASS=1
```

Hard requirements:
- **No `$(( ))` on zero-padded fields.** `$((08))` is an octal parse error in ash. Convert
  HH:MM → minutes with awk: `mins=$(printf '%s' "$t" | awk -F: '{print $1*60+$2}')`
  (awk treats `"08"` as 8). Same for "now": `date +%H:%M` through the same awk.
- Uptime: `awk '{print int($1)}' /proc/uptime`.
- Midnight wrap: `d = now - sched; if (d < 0) d = -d; if (d > 720) d = 1440 - d;` then
  compare ≤ tolerance. (Covers sched 23:58 vs now 00:03.)
- Year: `y=$(date +%Y)`; `case "$y" in ''|*[!0-9]*) return 1 ;; esac; [ "$y" -ge 2025 ]`.
  All arithmetic stays on 4-digit/minute-scale ints — no epoch math, no 32-bit hazard.
- Test injection: each function checks its `QM_TEST_*` env first and uses it verbatim
  when non-empty. This is the injectable-clock seam for off-device tests.
- No `date -d`, no jq (Entware jq lacks Oniguruma — `gsub`/`test`/`match` abort at
  runtime; irrelevant here but do not introduce jq anyway).
- Do not touch `_qm_validate_hhmm` / `_qm_validate_days` / `_qm_oncalendar_line`.

**Tests (write FIRST):** new file `scripts-dev/tests/test_timer_guard.sh` — plain
`sh`, no framework, runs on the dev machine (Git Bash) and on-device. It sources
`scripts/usr/lib/qmanager/schedule_timer.sh` relative to the repo root, drives the
guard purely through `QM_TEST_*` env, and prints `PASS/FAIL` per case with a non-zero
exit on any failure. Required cases:

1. Insane clock: `QM_TEST_YEAR=1970` → deny, regardless of uptime/schedule.
2. Non-numeric year → deny.
3. Settled boot: `QM_TEST_YEAR=2026 QM_TEST_UPTIME=4000`, no schedule → allow.
4. Boot window, no schedule: `QM_TEST_UPTIME=24` → deny (this is the issue #9 case).
5. Boot window, matching schedule: `QM_TEST_UPTIME=60 QM_TEST_NOW_HHMM=04:03`,
   sched `04:00` → allow (manual-reboot-near-schedule case).
6. Boot window, mismatching schedule: `QM_TEST_NOW_HHMM=10:29`, sched `04:00` → deny.
7. Midnight wrap: sched `23:58`, now `00:03`, uptime 60 → allow.
8. Tolerance boundary: sched `04:00`, now `04:10` → allow; now `04:11` → deny.
9. `QM_TIMER_GUARD_BYPASS=1` with everything else deny-shaped → allow.
10. Leading-zero fields (`08:09`) parse without error.

### Task B1 — `scripts/usr/bin/qmanager_scheduled_reboot` (CRITICAL path)

After the existing qlog/platform sourcing and **before** the OTA-interlock block, add:

- Source `/usr/lib/qmanager/config.sh` and `/usr/lib/qmanager/schedule_timer.sh`
  (both with the file's existing `2>/dev/null ||` tolerance pattern).
- `sched_time=$(qm_config_get settings sched_reboot_time "" 2>/dev/null)` (empty on
  any failure).
- If `_qm_timer_fire_allowed` is defined: `if ! _qm_timer_fire_allowed "$sched_time";
  then qlog_warn "Scheduled reboot skipped: fire outside schedule window (clock-step
  guard, issue #9)"; exit 0; fi`.
- **Fallback if the library failed to load** (fail-safe for a skewed OTA base): inline
  minimal guard — deny (exit 0 with qlog_warn) when uptime < 300s. A reboot payload
  must never run unguarded 24s into boot.
- Keep the OTA-interlock block unchanged, after the guard.
- Update the header comment: add a "CLOCK-STEP GUARD" paragraph mirroring the OTA GUARD
  paragraph, citing issue #9 and `docs/reference/scheduled-timers.md`.

### Task B2 — `scripts/usr/bin/qmanager_tower_schedule`

After mode validation (`apply|clear`) and before any config read / AT command:
- Source `schedule_timer.sh` (tolerant).
- Look up the mode's minute: apply → `.schedule.start_time`, clear → `.schedule.end_time`
  via `jq -r '... // empty' /etc/qmanager/tower_lock.json 2>/dev/null` (plain path
  extraction only — allowed). On any failure use `""`.
- Deny → `qlog_warn "Tower schedule $MODE skipped: fire outside schedule window
  (clock-step guard, issue #9)"; exit 0`. No inline fallback needed (payload is not a
  reboot); if the lib is absent, proceed as today.

### Task B3 — `scripts/usr/bin/qmanager_scenario_schedule`

After the `--now` arg check, before `get_active_profile`:
- Source `schedule_timer.sh` (tolerant); if loaded, `_qm_timer_fire_allowed ""`;
  deny → `qlog_warn` + `exit 0`. **Do NOT tear down the schedule on deny** — the
  teardown branches are for orphaned state only. Note in the comment: a skipped
  boot-window fire restores pre-0.1.13 behavior (no boot-time resolve existed);
  the next scheduled transition resolves state normally.

### Task B4 — `scripts/usr/bin/qmanager_auto_update` + `scripts/etc/systemd/system/qmanager-auto-update.timer`

- Worker: before the `update.auto_update_enabled` gate, source `schedule_timer.sh`
  (tolerant) and apply `_qm_timer_fire_allowed ""`; deny → `qlog_info "Auto-update
  check skipped: boot-window fire (clock-step guard, issue #9)"; exit 0`.
  This neutralizes BOTH the step fire AND the `Persistent=true` boot catch-up: each
  becomes a logged no-op, and the next daily elapse (computed post-step) runs within
  24h on an always-on device. This is the explicit answer to the "unattended firmware
  update on every boot" risk: pre-fix, an armed timer + available release could start
  an unattended install ~24s into every boot until the device reached the latest
  version; post-fix it cannot start inside the first 5 minutes of uptime at all.
- Timer unit (comment-only change): extend the `[Timer]` comment — `Persistent=true` is
  intentional for missed-day catch-up AND is only safe because
  `qmanager_auto_update` carries the boot-window fire guard; without the guard,
  catch-up fires at boot against a stepped clock (issue #9). Keep `Persistent=true`.

### Task C — Correct the misleading `Persistent=false` comments (comment-only)

In `qmanager_scheduled_reboot_arm` (:26–29), `qmanager_tower_schedule_arm`, and
`qmanager_scenario_schedule_arm`: extend (do not delete) the Persistent=false rationale
with: "Persistent=false does NOT guard the 1970 clock-step fire — systemd fires every
armed OnCalendar timer once when ql_time_daemon steps the clock at ~boot+24s. That case
is guarded worker-side via `_qm_timer_fire_allowed` in schedule_timer.sh (issue #9)."
No functional changes in these three files.

### Task D — Documentation

**D1. `docs/reference/scheduled-timers.md`:**
- Fix the `Persistent=false` bullet (currently :110–114): keep the downtime rationale,
  add that it is *not* a clock-step guard and why (stamp-file semantics), pointing to
  the new section.
- New section **"The 1970 boot window"**: the platform mechanism (no battery RTC,
  hctosys, ql_time_daemon + SIM dependency, `/tmp/ql_time_set_ready.flag`, measured
  timeline, systemd 244 past-base fire, once-per-boot self-heal), the four families'
  exposure table, the guard contract (§2.1 including the bypass env), and the
  explicit non-fixes list from §1 so nobody re-tries them.
- New **post-mortem subsection**: Scheduled Reboot was a silent no-op (dead crond)
  until 9bbd670 made it live on systemd timers, which hit a latent platform trap on
  upgrade — "making a dead feature live" inherits none of the field-testing the dead
  version appeared to have. Concrete forward check, stated as a rule: **any new
  `.timer` (or any change that arms one) must state in its PR/plan how it behaves
  when armed at 1970 and fired once at the clock step — either the payload sources
  `_qm_timer_fire_allowed`, or it uses monotonic `OnBootSec=`/`OnUnitActiveSec=`
  (immune), or it documents why a spurious step-fire is harmless.**
- Honesty note (§9 content, condensed): mechanism proven, causation on the reporter's
  device unconfirmed, SSR rival hypothesis not excluded, fix justified independently.

**D2. `CLAUDE.md`:** add ONE high-visibility platform fact (this file is loaded every
session; keep it to ~3 lines). Place it in the "RM520N-GL Platform" section as a short
paragraph right after the intro paragraph (before "Live Device Access"):

> **No battery RTC — every boot starts at Jan 1970.** Stock `ql_time_daemon` steps the
> clock ~24s into boot (requires a registered SIM; no SIM = 1970 forever), and systemd
> fires every armed `OnCalendar` timer once on that step. Any new timer payload must
> pass the fire guard in `schedule_timer.sh` or use monotonic `OnBootSec=` — see
> `docs/reference/scheduled-timers.md` ("The 1970 boot window").

Also update the existing routing-table row for Scheduled Reboot & Tower Lock Schedule
to mention "the 1970 boot window / clock-step fire guard" in its "touch it when" cell.
Do not add more than this — the detail lives in the reference doc.

### Task E — `RELEASE_NOTES.md`

Add to the existing `v0.1.14-draft` entry under `## 🐛 Fixes` (create the section if
absent, per the fixed template; do not touch the heading/OTA blockquote/Install/Thank
You blocks). One bullet, template tone (bold lead → one sentence of user-visible
behavior with UI location → compressed technical parenthetical), e.g.:

> - **Fixed a reboot loop after upgrading with Scheduled Reboot enabled.** If you had
>   **System Settings → Scheduled Operations → Scheduled Reboot** turned on, v0.1.13
>   could reboot the modem every 30–60 seconds whenever a SIM was installed — this
>   update makes every QManager schedule ignore the one false trigger that fires while
>   the modem is still setting its clock at boot (the modem has no clock battery; boots
>   start at 1970 and systemd fires armed timers once when the network sets the real
>   time).

Builders may tighten the wording but must keep the template shape and ≤2 sentences.

---

## 4. Test plan

**Off-device (runs in CI/dev, TDD inside Task A):**
- `scripts-dev/tests/test_timer_guard.sh` — the 10 cases in Task A, driven entirely by
  `QM_TEST_*` env injection. Must pass under `sh` (Git Bash) before B-tasks start.
- `sh -n` parse check on every modified script (`schedule_timer.sh`, the four workers,
  the three arm helpers).
- A green off-device run proves the guard's *logic*, not on-device behavior — BusyBox
  ash, the real `date`/`awk` applets, and systemd interaction are only exercised on
  the device.

**On-device, read-only (no approval needed) — `modem-investigator`:**
- Re-confirm platform facts post-plan: `hwclock -r` vs `date`, `/proc/uptime`,
  `cat /tmp/ql_time_set_ready.flag`, `systemctl list-timers --all`, confirm no
  `qmanager-*` timers armed (test unit has `sched_reboot_enabled: 0`).
- After a (separately approved) deploy: run `scripts-dev/tests/test_timer_guard.sh` on
  the device shell (it is env-driven and side-effect-free), and dry-run the guard path:
  `QM_TEST_UPTIME=24 /usr/bin/qmanager_scheduled_reboot` must log the skip to
  `/tmp/qmanager.log` and exit 0 **without rebooting** — verify via `qmanager_logread`
  / `/var/log/messages`, NOT journalctl (journald is disabled on this platform).
  CAUTION for whoever runs this: with QM_TEST_* unset and uptime > 300s this binary
  WILL reboot the device — always set the env when invoking manually.

**Gated (requires explicit user approval — flag before running, do not assume):**
- End-to-end reproduction/verification: enable Scheduled Reboot in the UI (a config
  write + timer arm), reboot the device, and observe exactly one denied fire logged at
  ~boot+24s with no reboot loop. This is the only test that proves the full chain; the
  plan is honest that without it we prove guard logic + a manual skip, not the armed
  boot path. Disarm afterwards (UI toggle off).

---

## 5. Validation phase (specialist agents, in order)

1. **`busybox-portability-checker`** — after Tasks A + B1–B4: octal-arithmetic hazard,
   awk/date applet usage, POSIX-sh compliance of the guard and test harness, no jq
   regex builtins introduced.
2. **`installer-safety-auditor`** — Tier-4 gate. Even though no installer lines change,
   the change set touches systemd unit comments, the reboot path, and OTA-relevant
   files; auditor must confirm: (a) no new files outside the existing lib/bin sweeps,
   (b) no sudoers change, (c) `schedule_timer.sh` still installs 644 via
   `install_dir_flat` (install_rm520n.sh:1112) and workers via the bin sweep, (d) no
   new config keys (so the missing-migration primitive is not triggered), (e) the
   guard's fail-open/fail-closed choices per worker match §2.2.
3. **`modem-investigator`** — the read-only checks in §4.

---

## 6. Rollback / safety

- The guard is skip-only: it cannot initiate a reboot, AT command, or update. If it is
  wrong in the deny direction, the user-visible symptom is "my scheduled reboot didn't
  happen", with a `qlog_warn` line in `/tmp/qmanager.log` and BusyBox syslog naming the
  guard and issue #9.
- If the fix ships broken in some other way, the known-good user workarounds remain
  unchanged and must stay working: disable Scheduled Reboot in the UI (tears the timer
  down via `qmanager_scheduled_reboot_arm teardown`), or
  `systemctl stop qmanager-scheduled-reboot.timer` over SSH; removing the SIM also
  stabilizes an already-looping device (clock never steps).
- No arming mechanics change, so rolling back is a plain OTA to the previous release —
  timers are regenerated from config on every install either way.

---

## 7. Explicitly NOT done (and why)

- No `ConditionPathExists` on any `.service` — racy (flag written at the step, i.e. at
  fire time) and superseded by the worker guard; documented in scheduled-timers.md so
  it is not "re-discovered" later.
- No boot-time re-arm oneshot — rejected in §2 (no-SIM devices would silently lose
  scheduling; adds boot complexity; guards only one cause).
- No change to `Persistent=` on any unit; no time-sync.target ordering (inert here).
- No new config keys, no sudoers changes, no CGI changes, no frontend changes.

---

## 8. Per-family decision summary

| Family | Decision |
|---|---|
| scheduled-reboot | **Fix** (Task B1 + fallback inline guard — the boot-loop payload gets two layers) |
| tower-schedule apply/clear | **Fix** (Task B2, schedule-minute-aware) |
| scenario-schedule | **Fix, uptime-only** (Task B3 — misfire was near-harmless but the skip restores pre-0.1.13 semantics for free) |
| auto-update | **Fix, uptime-only; keep Persistent=true** (Task B4 — guard converts both step-fire and boot catch-up into logged no-ops) |

Nothing is deferred.

---

## 9. What we could NOT prove (keep this in the doc, do not overclaim)

- **Causation on the reporter's device is unconfirmed.** Our test unit has
  `sched_reboot_enabled: 0` and no qmanager timers armed, so the loop is not
  reproducible there as-is; journald is disabled device-wide, so the reporter could not
  have observed the fire either. We proved the mechanism (systemd 244 source + live
  timeline measurement), not the specific device's causal chain.
- **A rival hypothesis is not excluded:** a modem-side subsystem restart (SSR) at SIM
  attach also fits a 30–60s SIM-correlated reboot signature with fewer assumptions.
- The fix is justified regardless: the clock-step fire mechanism is proven on this
  platform, and a reboot worker that executes unconditionally on any spurious start is
  an independent defect. If the reporter's loop persists after this fix, investigate
  SSR next — do not assume this closed it until the reporter confirms.

---

## 10. Reference: verified code locations (for builders)

- `scripts/usr/lib/qmanager/schedule_timer.sh` — validators :39–67, `_qm_oncalendar_line` :76–100 (pure string, `date` never called; emits recurring weekday form).
- `scripts/usr/bin/qmanager_scheduled_reboot_arm` — Persistent comment :26–29, unit write :112–122, hand-link :131–136.
- `scripts/usr/bin/qmanager_scheduled_reboot` — OTA interlock :33–40; `reboot` at :43; no other guard.
- `scripts/usr/bin/qmanager_tower_schedule_arm` — `write_timer()` with Persistent=false; `scripts/usr/bin/qmanager_tower_schedule` — modes apply/clear, jq path reads of `/etc/qmanager/tower_lock.json`.
- `scripts/usr/bin/qmanager_scenario_schedule_arm` :120–150; worker `qmanager_scenario_schedule --now` (resolve-at-fire-time, self-healing teardown branches).
- `scripts/etc/systemd/system/qmanager-auto-update.timer` :11–13 (`OnCalendar=daily`, `RandomizedDelaySec=3h`, `Persistent=true`); worker config gate `update.auto_update_enabled` (default 0).
- `scripts/install_rm520n.sh` — lib sweep :1112 (`install_dir_flat`), config-driven re-arm of all schedule timers in `enable_services()` ~:2097–2160 (first post-OTA boot = fresh timer + 1970 clock).
- `scripts/usr/lib/qmanager/config.sh` :48–50 — `sched_reboot_enabled` seeds 0; `sched_reboot_time` "04:00".
- `scripts/usr/lib/qmanager/alert_engine.sh` :18–19 — the existing "never date +%s for durations" precedent; `_ae_append_reboot_history` (NDJSON `/etc/qmanager/reboot_history.json`) — not used by this fix (the uptime check subsumes a min-interval-since-last-reboot check: any loop implies low uptime).
- `docs/reference/scheduled-timers.md` :110–114 — the Persistent=false bullet to correct.
