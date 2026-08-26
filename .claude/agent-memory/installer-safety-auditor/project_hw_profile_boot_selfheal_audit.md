---
name: project_hw_profile_boot_selfheal_audit
description: Phase A Task 3 audit (2026-08-25) - qmanager_setup self-healing platform.json at boot; CLEAR verdict, double-write pattern precedent
type: project
---

Phase A Task 3 (2026-08-25): made `qmanager_setup` self-heal `/etc/qmanager/platform.json`
(advisory hw-identity profile) at every boot via a new `qm_hw_profile_needs_write()` in
`hw_profile.sh`, inserted just before the `chown -R www-data:www-data /etc/qmanager` at
qmanager_setup:151. Phase 1 verdict: CLEAR, no blockers.

**Why:** platform.json was previously written ONCE by install_rm520n.sh's preflight()
(:536-546). This task adds a second writer so a device that skips reinstall (or gets a
modem firmware reflash) still gets a correct profile.

**Findings worth reusing on later Phase A tasks:**

1. **Double-write-per-install is by design, already anticipated.** `preflight()` writes
   platform.json, then `start_services()` unconditionally does
   `systemctl restart qmanager-setup` (installer AND OTA — OTA never passes `--no-start`,
   per [[project_installer_stop_start_ordering]]), which now ALSO writes it. Both writes
   happen sequentially in the same shell, both go through `qm_hw_write_profile`'s
   same-dir tmp+mv, both write identical content since the live fingerprint hasn't
   changed mid-install. `scripts/test/installer-platform-json.sh:18-26` already
   documents this exact interaction as the reason that harness tests preflight in
   isolation (by anchor-extraction) rather than on-device, since post-boot-self-heal
   would mask T2 being completely broken. Read that comment before auditing anything
   that touches platform.json again.

2. **`${QM_LIB_DIR:=...}` / `${QM_CONF_DIR:=...}` env-var indirection in a ROOT
   systemd oneshot is safe IF AND ONLY IF the unit has no `EnvironmentFile=`/
   `Environment=`/`PassEnvironment=`.** `systemctl start/restart` does NOT forward the
   calling shell's environment into the spawned unit process — systemd uses its own
   manager-level environment block, not fork+exec inheritance. Verified
   `qmanager-setup.service` has none of those directives. The pattern itself already
   has precedent in two CGI scripts (`ping_profile.sh:38`, `quality_thresholds.sh:17`
   use `${QM_LIB_DIR:-...}`), where their own test harnesses (`scripts/test/*-cgi.sh`)
   override it — same "let a workstation harness stub the path" motive. Re-verify the
   "no EnvironmentFile on this unit" precondition before approving this pattern on any
   OTHER root daemon/oneshot — it does not generalize to qmanager-poller/-ping/-watchcat/
   -discord, which DO have `EnvironmentFile=-/etc/qmanager.env`.

3. **Uninstall (non-purge) fully removes the boot-time writer.** `uninstall_rm520n.sh`
   Step 2's filesystem-driven `$SYSTEMD_DIR/qmanager-*.service` glob (:302-306) catches
   `qmanager-setup.service` and removes both the unit AND its wants-symlink; Step 1/3
   kill and remove the binary. So a self-healing boot-time writer added to
   qmanager_setup does NOT create a "leftover writer after uninstall" hazard — confirm
   this glob-catches-it precondition again for any future qmanager-setup change, since
   it's what makes "self-heal at boot" safe to add to a oneshot at all on this platform.
