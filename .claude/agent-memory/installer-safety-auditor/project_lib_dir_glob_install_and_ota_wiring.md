---
name: project_lib_dir_glob_install_and_ota_wiring
description: scripts/usr/lib/qmanager/*.sh is installed by a glob loop, not an enumerated list — a new lib file needs zero installer edits, and OTA re-runs the full installer so it rides along automatically
type: project
---

`install_rm520n.sh`'s `install_backend()` installs shared libs via:
```
lib_count=$(install_dir_flat "$SRC_SCRIPTS/usr/lib/qmanager" "$LIB_DIR" 644)
```
(`install_rm520n.sh:1112`) — `install_dir_flat` (`:198-208`) is a `for f in
"$src"/*` glob loop, not an enumerated per-file list. `install_file`
(`:181-194`) CRLF-strips (unless the file sniffs as ELF) and applies mode
644. `LIB_DIR` itself is `install -d -o root -g root -m 0755` (`:1109`),
re-asserted every run. **A brand-new `scripts/usr/lib/qmanager/<name>.sh`
file needs zero edits to the installer to be picked up.**

Uninstall is equally free: `uninstall_rm520n.sh:338` does `rm -rf
"$LIB_DIR"` wholesale. Legacy pruning (`install_rm520n.sh:1861-1871`) also
removes any `*.sh` under `LIB_DIR` not present in the current source tree —
self-cleaning by filesystem diff, matching [[project_config_pruning_asymmetry]]'s
description of the lib dir (as opposed to `/etc/qmanager`, which is
additive-only).

**OTA path:** `qmanager_update`'s upgrade/rollback code paths (confirmed at
roughly 3 call sites) all shell out to
`sh install_rm520n.sh --force --skip-packages --no-reboot` — i.e. OTA
re-runs the FULL installer, not an enumerated file-sync list. Only
`--skip-packages` (opkg/package installs, see
[[project_ota_skips_packages]]) is skipped; the lib-dir glob-install above is
NOT gated by that flag, so it runs on every OTA. A new lib file is present
on every upgraded device with no separate OTA wiring required.

**How to apply:** when auditing a change that adds a new
`scripts/usr/lib/qmanager/*.sh` file, this whole class of Phase-1 concern
(explicit install list edit? OTA enumeration gap?) is a non-issue — verify
the glob/full-reinstall mechanism is still in place (grep for
`install_dir_flat` and the OTA's `install_rm520n.sh` invocation) rather than
assuming an explicit list needs a new line.
