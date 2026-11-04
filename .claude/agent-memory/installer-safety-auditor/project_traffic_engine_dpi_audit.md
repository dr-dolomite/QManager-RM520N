---
name: project_traffic_engine_dpi_audit
description: Phase 5 verify-mode audit of PR #11 (Traffic Engine / tpws re-port of DPI feature) installer footprint
type: project
---

Traffic Engine (tpws/zapret re-port of the old nfqws Video Optimizer/Traffic
Masquerade feature) — PR #11 by carp4, audited on `merge-scratch` (development
+ pr-11-carp4) 2026-08-26. Verdict: BLOCKED on one concrete defect, otherwise
clean.

**The defect**: `scripts/uninstall_rm520n.sh` never removes
`$QMANAGER_ROOT/bin` (the tpws binary directory the installer creates at
`scripts/install_rm520n.sh:1479` via `install -d -o root -g root -m 0755
"$QMANAGER_ROOT/bin"`, populated on-demand by `qmanager_dpi_install`). The
final teardown line `rmdir "$QMANAGER_ROOT" 2>/dev/null || true`
(uninstall_rm520n.sh:664) only succeeds on an EMPTY directory — if the user
ever ran the Traffic Engine's on-demand tpws install, `bin/tpws` still exists
at uninstall time, the rmdir fails silently, and `/usrdata/qmanager/` is
stranded after a purge uninstall. This is the EXACT bug class the file's own
comments already warn about twice (apn_names.json at line 634-636,
locales-packs at line 646-649) — a new sibling-of-www/ subdirectory under
$QMANAGER_ROOT needs an explicit `rm -rf` before that final rmdir, added
unconditionally (not gated on --purge) alongside where WWW_ROOT/CERT_DIR/
CONSOLE_DIR are torn down, since it's an installed binary, not user config.

**Everything else in this PR's installer footprint was clean**:
- Sudoers: two new bare-path NOPASSWD grants (`qmanager_dpi_install`,
  `qmanager_dpi_verify`), no wildcards. The pre-existing `systemctl
  start/stop/restart qmanager-*` wildcard already covers qmanager-dpi.service
  — no new sudoers surface needed for service control.
- Timer: qmanager-dpi-ensure.timer is `OnBootSec=60`+`OnUnitActiveSec=60`,
  correctly monotonic, no OnCalendar.
- Deployment: dpi_state.sh, the three qmanager_dpi_* binaries, and all three
  systemd units are picked up by the EXISTING glob loops (`usr/lib/qmanager/*`
  flat glob, `usr/bin/*` flat glob, `qmanager*.service`/`qmanager*.timer`
  globs) — zero explicit installer wiring needed, confirms
  [[project_lib_dir_glob_install_and_ota_wiring]] extends to systemd units too.
- Config migration: new `video_optimizer`/`traffic_masquerade` sections are
  read exclusively via `qm_config_get` with an explicit default at every call
  site, and written via `qm_config_set`, whose `jq '.[$s][$k] = $v'` AUTO-
  VIVIFIES a missing section — confirmed this is a general property of
  config.sh's write path, not something this PR added. An OTA-upgraded device
  with no `video_optimizer` key in its qmanager.conf reads defaults correctly
  and the first save creates the section on demand. No explicit migration
  step was needed and none is missing.
- /tmp seeding: qmanager_setup correctly seeds the 4 new DPI marker files
  (`qmanager_dpi_install.{json,pid}`, `qmanager_dpi_verify.{json,pid}`)
  root:root 0666 alongside the pre-existing tower_write_inflight seed; all
  DPI root helpers write markers in-place (never tmp+mv), matching
  tmp-file-ownership.md.
- Binary provisioning (qmanager_dpi_install): downloads tpws from
  bol-van/zapret GitHub releases, verifies sha256 against the release's
  sha256sum.txt manifest AND an embedded offline pin, refuses install on any
  mismatch, installs root:root 0755 to a directory www-data cannot write
  (`/usrdata/qmanager/bin`, outside www-data-owned `/etc/qmanager`) — correct
  root-code-execution boundary.
- No in-flight reboot anywhere in the CGI (`video_optimizer.sh`) or the three
  qmanager_dpi_* root helpers.

**Non-blocking observation**: qmanager_dpi_install/_run/_verify accept
internal-only verbs (`--download`, `--uninstall-run`, `--run`) directly since
the sudoers grant is a bare path with no arg restriction (by design — see
[[feedback_sudoers_arg_validation_pattern]]) — www-data could invoke
`--download` twice concurrently, bypassing the PID-file already-running guard
that only the `install` verb checks. Tmp paths use `$$` so no filename
collision, so worst case is wasted bandwidth/CPU, not corruption. Consistent
with existing repo convention (other qmanager_* root helpers have the same
shape); not flagged as a blocker.
