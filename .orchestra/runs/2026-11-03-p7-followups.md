# P7 follow-ups (2026-11-03)

Base: `development` @ 63acb890. Scope (user list): items 1, 2, 3, 7, 8, 9 of the handoff brief. Out of scope: tower unlock, tower NR-SA digits, bands supported check, untested P7b validation.

## Small (no plan stop)
- **A. Backend (1–3)** — one worktree builder (cgi-endpoint-builder):
  1. `config.sh` `qm_config_set` / `qm_config_delete` / `qm_config_delete_section`: per-call `mktemp` in `/etc/qmanager`, `flock -x` on a lock fd around read-modify-write.
  2. `system/config-backup/apply.sh`: make the 409 check + worker spawn atomic (flock or `mkdir` lock).
  3. `scenarios/save.sh`: unique `custom-<epoch>` id (suffix while the file exists).
- **B. Frontend (9)** — one worktree builder (ui-builder): `lib/web-port.ts` / `hooks/use-web-port.ts` / card + onboarding: poll `system/web_port.sh` `last_result` on both origins before navigating; on `rolled_back` stay and say so.
- Validation: device run of A in `/tmp` copies only (no live config writes without OK); busybox-portability-checker on A; blind qm-verifier on A and B.

## Large (plan stop)
- **C. Root helpers for MTU (7) + hostname (8)** — recon first (qm-scout), then a plan in this file, installer-safety-auditor before and after, user OK before build and before any device write.

### C recon (qm-scout, checked)
- MTU: `conn_mtu_set` (connection_store.sh:170) writes `/etc/firewall.user.mtu` + `ip link set`; `/etc` is root:root 755, so www-data fails both. `mtu.sh:163` ignores its rc and reports success. `qmanager_mtu_apply` is boot-only (qmanager-mtu.service), no sudo grant. Re-apply after a tower bounce (`mtu_reapply_after_bounce`, tower_lock_mgr.sh:814) can also run from a www-data CGI.
- Hostname: `sys_set_hostname` (system_config.sh:27). `/etc` is its own rw UBIFS (ubi2_0), so the `remount,rw /` does nothing for it; the block is `/etc/hostname` root:root 0644 and `/proc/sys/kernel/hostname`. Same on RG501Q-EU. No hostname validation anywhere.
- Install: `install_rm520n.sh:1822-1830` copies all `scripts/usr/bin/*` (no list edit); sudoers installed visudo-checked at :1949-2022; uninstall removes sudoers at :448-457.

### C plan
1. `scripts/usr/bin/qmanager_mtu_set` (root, PATH pinned, timezone_apply model): `set <n>` (validate 576–9000 digits only, write file via temp inside /etc + mv, apply to `rmnet_data*`), `disable` (remove file), `apply` (re-run the file). JSON result, rc 0/1.
2. `scripts/usr/bin/qmanager_hostname_apply <name>` (root): validate RFC 1123 label (1–63, `[A-Za-z0-9-]`, no edge hyphen), write `/etc/hostname` via temp in /etc + mv + sync, write `/proc/sys/kernel/hostname`. No rootfs remount.
3. Sudoers: two bare-path lines in `scripts/etc/sudoers.d/qmanager`.
4. Callers: `conn_mtu_set` / `conn_mtu_disable` and `mtu_reapply_after_bounce` → `sudo -n` helper (fall back to direct when already root); `mtu.sh` returns an error when the rc is 1. `sys_set_hostname` → validate, then helper; `settings.sh` and the `system` applier report failure.
5. Lockstep: install copies by glob; check OTA path and uninstall (remove both helpers if uninstall lists binaries).
6. Gates: installer-safety-auditor before and after; busybox-portability-checker; qm-verifier. Device: deploy helpers + sudoers on RM520N-GL, set MTU 1420 then disable, set hostname then restore `sdxlemur` — each step needs the user's OK.
- Risk: a bad sudoers file breaks every sudo CGI — install is visudo-checked; deploy by hand only after `visudo -c -f` on the device. Rollback: remove the two lines and helpers; restore `/etc/hostname`.

## Log
- 2026-11-03: plan written; A, B and the C recon dispatched.
- 2026-11-03: user added items 4–6 (tower unlock-when-unlocked, tower NR-SA digit check, bands supported check) to A; real lock/unlock runs need the user's OK.
- 2026-11-03: user OK'd plan C. Auditor pre-gate BLOCKED on 2 plan gaps, folded into the build brief: (1) hostname config value stays a display name; `sys_set_hostname` derives an RFC 1123 label for the system, skips when empty, and a helper failure is a distinct rc that the restore does not retry; (2) helpers chmod 644 / chown root before `mv`. Also: `apply` never sources the MTU file; strict arg checks. C build dispatched on `claude/p7-followups-root-helpers`.
- A built: `claude/p7-followups-backend` cc52da22 + bd2d0672 (locale keys). Portability: SAFE TO SHIP (both devices). qm-verifier running.
- B built: `claude/p7-followups-webport` c7960cb5 (also fixed a no-cors + redirect:"manual" probe that always failed). qm-verifier running.
- C built: 0f36dfa5; follow-up for settings.sh early return + locale keys in progress; auditor post-gate after.
- All verified (PASS_WITH_NOTES each; notes fixed). Tips: backend 92a9b5a6, root-helpers 2da68d90 (auditor post-gate CLEAR), webport 34b69523. Trial merge: only conflict is docs/reference/config-backup.md (backend vs root-helpers). RELEASE_NOTES not yet written. Live device checks pending user OK.
