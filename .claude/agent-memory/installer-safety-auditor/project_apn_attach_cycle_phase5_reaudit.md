---
name: project_apn_attach_cycle_phase5_reaudit
description: Phase 5 verify-mode outcome for the apn-attach-cycle change (worktree wt+apn-attach-cycle, diff vs d469a61) — PASS, the Phase 1 recovery-flag blocker was resolved by making the flag root-worker-only
type: project
---

Re-audited 2026-08-03. Original Phase 1 BLOCKER was `chmod 0666` on `/tmp/qmanager_recovery_active` as a fix for the cross-UID unlink problem under `/tmp`'s sticky bit ([[project_shared_tmp_flag_sticky_bit_hazard]]). Resolution actually shipped: the chmod approach was dropped; the flag is now touched/cleared ONLY by `scripts/usr/bin/qmanager_profile_apply` (root worker) — `apn.sh` and `profiles/deactivate.sh` (www-data CGI) never reference it at all (`grep RECOVERY_FLAG` across `scripts/www` returns nothing). Single-UID-owned by construction, so the sticky-bit unlink problem cannot arise. `qmanager_watchcat` was left untouched (absent from `git diff d469a61 --name-only`), confirming it stayed out of scope. The self-heal (clear a stale flag only after `[ -d "/proc/$pid" ]` liveness check) mirrors `qmanager_watchcat:198-215`'s existing idiom for its own PID file — same pattern, not a new primitive.

Fail-closed sourcing recommendation was implemented in all 3 consumers (`qmanager_profile_apply:452`, `apn.sh:87`, `deactivate.sh:54`) via `command -v apn_apply_write >/dev/null 2>&1 || <hard fail>` — genuinely fails closed (no bracket attempted on missing lib), not the codebase's usual defensive `[ -f ] &&` fall-through.

Installer/OTA/sudoers/systemd surface: confirmed zero installer-family files in the diff (`install_rm520n.sh`, `qmanager-installer.sh`, `uninstall_rm520n.sh` all absent). New lib `scripts/usr/lib/qmanager/apn_apply.sh` needs no installer edit — `install_dir_flat()` globs `"$src"/*` with only an `[ -f ]` filter, no extension allowlist ([[project_lib_dir_glob_install_and_ota_wiring]]). `qcmd` untouched — the proposed change there was reverted after hardware measurement (`AT+COPS=0` returns in 0.16s, inside the 5s flock budget).

One new installer-adjacent surface: `qmanager_profile_apply`'s `_apn_sidecar_converge` (root) now writes `/usrdata/qmanager/apn_setting.json`, which `apn.sh`'s `write_setting_json` (www-data) also targets. Live-confirmed this is NOT a new clobber risk — see [[project_usrdata_qmanager_root_dir_blocks_www_data_writes]]: the parent directory is 0755 root:root, so www-data was already unable to create/rename a file there before this change (the file didn't exist on the live device at all). The root path is the first writer that can actually succeed; flagged as a residual follow-up (apn.sh's own sidecar write is effectively dead code today) but not a blocker for this diff.

Verdict: PASS. No installer-family file touched, no new systemd/sudoers/binary/usrdata path introduced, nothing left disabled/world-writable/orphaned on uninstall.
