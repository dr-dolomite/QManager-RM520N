---
name: project_ping_daemon_retirement
description: Rust ping-daemon -> POSIX shell qmanager_ping swap, live-confirmed schemas and hazards (audited 2026-07-19)
type: project
---

Tier-4 initiative (Phase-1-gated 2026-07-19): retiring the compiled Rust
`qmanager_ping` (`ping-daemon/`, ~978KB ARMv7 musl ELF) in favor of a POSIX
shell daemon ported from the sibling RM551E project
(`D:\Projects\QM PROJECT\QManager\scripts\usr\bin\qmanager_ping`), plus
removing the "Connectivity Sensitivity" user-tunable UI
(`components/system-settings/connection-quality/connectivity-sensitivity-card.tsx`,
CGI `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`) so
`qmanager_watchcat` owns ping control instead.

**Verdict at Phase 1 audit: PROCEED, not blocked** — the installer's existing
mechanisms absorb almost all of the risk automatically (see
[[project_install_file_elf_and_config_defaults]] and
[[project_config_pruning_asymmetry]]). Only one net-new step is required.

Key confirmed facts:
- `scripts/usr/bin/qmanager_ping` is filename-stable — installer just
  `install_file`s whatever's at that source path with mode 755
  (install_rm520n.sh line 958). Swapping ELF→shell needs ZERO installer
  changes: CRLF-stripping auto-applies to the new text file, exec bit is set
  unconditionally, `cleanup_legacy_scripts()` never touches it because the
  filename didn't change.
- `qmanager-ping.service` (`scripts/etc/systemd/system/qmanager-ping.service`)
  has no `User=` (runs as root under Type=simple) so raw ICMP via `ping`
  needs no `cap_net_raw`/setuid — confirmed live, busybox `ping` present at
  `/bin/ping`. Unit is correctly persisted via the direct
  `/lib/systemd/system/multi-user.target.wants/qmanager-ping.service` symlink
  (live-confirmed present and pointing correctly) — `systemctl is-enabled`
  reports "disabled" for ALL qmanager units on this platform, that's expected
  platform behavior (this platform doesn't use the conventional enable path),
  not a bug. Only the unit's stale `Description=...(Rust)` and the
  `PING_TARGET_1`/env-override comment block need editing — cosmetic, still
  requires the existing `systemctl daemon-reload` at install_rm520n.sh:1016
  (already unconditional).
- Not in `UCI_GATED_SERVICES` (qmanager-watchcat, qmanager-tower-failover,
  qmanager-discord only) — stays in the always-on unconditional-enable path,
  correct, no reclassification needed.
- OTA (`qmanager_update`/`qmanager_auto_update`) re-runs
  `install_rm520n.sh --force --skip-packages --no-reboot` wholesale (matches
  [[project_ota_skips_packages]]), verified via single whole-tarball SHA-256 —
  no per-file/ELF-specific manifest handling exists to break.
- **The one required net-new step**: `/etc/qmanager/ping_profile.json` is a
  Bucket-3 (additive-only, never-pruned) config file — live-confirmed schema:
  `{profile, interval_sec, fail_secs, recover_secs, intercept_secs,
  history_secs, target_1, target_2}`. It will survive forever on
  OTA-upgraded devices, unread, once the new daemon ignores it. Needs an
  explicit prune step added to `install_backend()` in install_rm520n.sh,
  following the exact idempotent pattern already proven by
  `migrate_ping_environment()` / `prune_stale_ping_environment()`
  (install_rm520n.sh lines ~1150-1239) — that function even names its backup
  `${env_file}.pre-rust-ping.bak`, i.e. this exact kind of ping-config
  migration has precedent in this codebase already. Add
  `remove_stale_ping_profile()` (or fold into `prune_stale_ping_environment`)
  called unconditionally alongside `install_ping_profile()`.
- `/etc/qmanager/environment` — live-confirmed to currently hold NO `PING_*`
  keys on the test device (the CGI only ever wrote to `ping_profile.json`,
  never to the env file — env overrides were a manual power-user escape
  hatch only). Low residual risk, but the new daemon should simply ignore any
  `PING_*` env vars it finds rather than erroring if a stray manually-added
  one exists.
- No sudoers entry references ping anywhere (confirmed via grep across
  `scripts/etc/sudoers.d/`) — `ping_profile.sh` writes `/etc/qmanager/`
  directly as `www-data` because `CONF_DIR` is `chown -R www-data:www-data`
  (install_rm520n.sh:1063). Removing the CGI script orphans nothing in
  sudoers.
- Cross-cutting (not installer-safety's lane, flag to cgi-endpoint-builder):
  `qmanager_watchcat`'s `read_ping()` parses `/tmp/qmanager_ping.json` as
  6 tab-separated fields via `cut -f1..f6`
  (`scripts/usr/bin/qmanager_watchcat` line 230-254), and `qmanager_poller`
  reads the same file plus a flat-file history ring buffer at
  `/tmp/qmanager_ping_history`. The new shell daemon's output schema MUST
  match exactly or watchcat/poller silently break — this is a runtime
  contract, not an install-time one, so it's outside this audit's invariants
  but is the single biggest functional risk of the whole initiative.
