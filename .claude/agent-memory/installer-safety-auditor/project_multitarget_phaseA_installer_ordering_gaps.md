---
name: project_multitarget_phaseA_installer_ordering_gaps
description: install_rm520n.sh's --force flag skips tier/firmware detection entirely, and lighttpd/auto-update are not systemd-ordered after qmanager-setup — both bite any install-time-generated state (e.g. a future platform.json)
type: project
---

Found during the Phase 1 gate audit of multi-target modem support Phase A
(2026-08-24). Two independent traps for any feature that wants to generate or
read state derived from `/etc/quectel-project-version` at install/boot time.

**Trap 1 — `--force` skips the ENTIRE tier-detection block, not just the
prompt.** `scripts/install_rm520n.sh` `preflight()`, lines 361-409: under
`[ "$DO_FORCE" = "1" ]` the whole `if/else` — including the read of
`/etc/quectel-project-version`, the `project_name`/`ver` parse, and the tier
`case` — is replaced by a single warning. `DO_FORCE=1` is exactly what
`qmanager_update` passes on **every OTA install**
(`sh install_rm520n.sh --force --skip-packages --no-reboot`, at
`qmanager_update:260,464,576,651`). So any logic naively added inside that
existing case block (the obvious place, since it's where the file is already
parsed) never runs on an OTA-upgraded device. New install-time logic that must
run unconditionally (e.g. writing a profile file) needs its own function,
called outside the `DO_FORCE` gate, doing its own independent read of
`/etc/quectel-project-version` — it cannot reuse `$project_name`/`$ver`, which
are `local` to `preflight()` and stay unset when `DO_FORCE=1`.

Related dead code found nearby: `detect_modem_firmware()`
(`install_rm520n.sh:263-290`) looks like "the place tier detection already
lives" but is defined and never called anywhere, and hardcodes `grep -i
"RM520N"` in three places. Don't wire new logic through it without
generalizing those filters (same bug class as the `qcmd_test` RM520N-hardcode
the design spec already flags in its own §6.1).

**Trap 2 — lighttpd and the auto-update timer are not ordered after
qmanager-setup.** `scripts/etc/systemd/system/lighttpd.service` declares only
`After=network.target opt.mount`; `qmanager-auto-update.service` declares only
`After=network-online.target`. Neither has `After=qmanager-setup.service`,
even though `qmanager-setup.service` itself only declares `Before=` on ping
and poller (`Before=qmanager-ping.service qmanager-poller.service`) — nothing
orders it before lighttpd or auto-update. Confirmed by reading every
`qmanager-*.service`'s `After=` line; also worth noting
`qmanager-auto-update.timer` is `OnCalendar=daily, Persistent=true`, so on a
device that missed its scheduled run it can fire at the 1970→real clock step
very early in boot (~24-29s), i.e. squarely in the same window setup runs in.
**Any CGI (lighttpd-served) or the auto-update worker that reads
install-time-generated state under `/etc/qmanager/` must handle that file's
absence** — it is not guaranteed to exist yet when either starts.

**How to apply:** before shipping any new `qmanager_setup`-written file that a
CGI script or a systemd-timer-fired worker consumes, either (a) add the
missing `After=qmanager-setup.service` line to that consumer's unit, or (b)
require the consumer to fail-safe (default/fallback value) on a missing file
— never assume ordering that isn't declared. See also
[[project_multitarget_phaseA_ota_url_checksum_fragility]].
