---
name: project_lighttpd_collision_phase5_reaudit
description: Phase 5 re-audit of the Entware S80lighttpd port-80 collision fix (F8) — CLEAR TO SHIP, all three Phase 1 blockers genuinely met
type: project
---

Phase 5 verify-mode audit (2026-08-25) of the F8 lighttpd-collision fix in
`scripts/install_rm520n.sh` (`neutralize_entware_lighttpd()` ~:595, `opt.mount`
enable block in `enable_services()` ~:2983), `scripts/uninstall_rm520n.sh`
(~:318-327), and `scripts/etc/systemd/system/lighttpd.service` (PIDFile=
deleted). Verdict: **CLEAR TO SHIP**, all three Phase 1 blockers MET.

**Why this matters:** the bug is a genuine intermittent boot race — Entware's
`S80lighttpd` (rc.unslung, `pidof lighttpd` name-check, no port check) vs
QManager's `lighttpd.service`. Fix disables S80lighttpd's exec bit
(rc.unslung selects by `-perm -u+x -name 'S*'`, no allowlist) and separately
fixes `opt.mount` never being symlinked into `multi-user.target.wants/`
(previously only reached via `start-opt-mount.service`'s in-service
`systemctl start opt.mount`, which self-deadlocks on systemd's job queue for
~3.7s — that's what ate the boot-race margin).

**Verified structurally + by running the shipped test harness**
(`scripts/test/installer-lighttpd-collision.sh`, 14/14 pass):
- Call site (`main():3595`) is a bare statement, NOT chained to
  `[ "$DO_PACKAGES" = "1" ] && install_dependencies` (:3585) — reaches OTA
  (`qmanager_update` invokes `--force --skip-packages --no-reboot`, so
  `install_dependencies()` never runs on OTA at all — see
  [[project_ota_skips_packages]]).
- Ordering: neutralize call (:3595) is textually AFTER the
  `install_dependencies` call site (:3585), so a same-run `opkg
  upgrade/install lighttpd` (:1142-1148, re-extracts S80lighttpd with exec
  bit restored) cannot silently re-arm it.
- Idempotent: `[ ! -f ]` / `[ ! -x ]` guards, `chmod -x` failure only
  `warn`s, function ends `return 0` on every path — can never `die()`.
- Uninstall restore (`uninstall_rm520n.sh:324-326`) is genuinely in Step 2's
  executed body (:300 `step "Removing systemd units..."`), NOT inside
  `usage()` (:97-118, help text only) — confirmed by grepping both bodies
  separately.
- `opt.mount` enable block sits inside the same `mount -o remount,rw /`
  ... `sync` bracket that already wraps all of `enable_services()` (rw at
  :2956, sync at function end) — no separate remount needed since the
  writes are symlinks into `/lib/systemd/system/...` (rootfs).
- Repo-wide grep: nothing has `After=start-opt-mount.service`; only
  `lighttpd.service` has `After=opt.mount` (the real mount unit) — so
  keeping `start-opt-mount.service` as a fallback is genuinely harmless: its
  `systemctl start opt.mount` merges into the already-enabled unit's own
  job, no double-mount, and lighttpd's boot-order safety comes from
  `opt.mount` now actually being pulled into the multi-user.target
  transaction (previously it wasn't pulled at all — `After=` alone doesn't
  pull a dependency in).

**One residual low-severity gap, not blocking:** neither
`neutralize_entware_lighttpd()` nor the uninstall restore track *who*
disabled S80lighttpd. If a user manually `chmod -x`'d it themselves before
ever installing QManager (e.g. running their own port-80 service), uninstall
will unconditionally re-`chmod +x` it, silently reverting a deliberate user
choice that predates QManager. Low probability, no marker file exists to
disambiguate — flag if this pattern (permission-bit-as-state, no owner
marker) recurs elsewhere.

See also [[project_ota_skips_packages]], [[project_installer_stop_start_ordering]].
