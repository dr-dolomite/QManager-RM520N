---
name: project_crash_log_dual_writer_audit
description: 2026-07-20 Phase 1 gate verdict on adding www-data as a second writer to /etc/qmanager/crash.log alongside root-run qmanager_watchcat — BLOCKED on raw chmod 664, root-helper appender recommended instead
type: project
---

Audited a Tier-3→4 design (centralized Alerts page + watchdog-wired alerts) that wanted to widen `/etc/qmanager/crash.log` to `chown root:www-data` + `chmod 664` so `scripts/www/cgi-bin/quecmanager/system/reboot.sh` (runs as www-data) could append a `<epoch>|reboot|user` breadcrumb alongside root-run `qmanager_watchcat`'s existing `<epoch>|reboot|tier4_escalation` breadcrumbs (`scripts/usr/bin/qmanager_watchcat` line 63 `CRASH_LOG=`, append at line 503, trim-to-20 at 505-513).

**Verdict: BLOCKED as specified.** Two reasons, both load-bearing:

1. The explicit `chown root:www-data` + `chmod 664` step is redundant with, and will be silently reverted by, the existing recursive `chown -R www-data:www-data "$CONF_DIR"` at `install_rm520n.sh:1124` which runs on every install/OTA — see [[project_conf_dir_recursive_chown]]. Whatever ownership the crash.log-specific step sets will flip back to www-data:www-data on the next OTA unless deliberately sequenced to run after line 1124 every time, which is a fragile, undocumented ordering dependency.
2. Because `/etc/qmanager` itself is www-data-owned (same recursive chown), www-data already has directory-level rights to delete-and-replace `crash.log` with a symlink — a raw `>>` from root-run watchcat into that path is symlink-attackable (redirect to `/etc/passwd`, a systemd unit, etc. -> root writes attacker content there on next Tier-4 event). Widening write access on the file itself doesn't fix this and slightly raises its profile as an attack target since the design now gives www-data a designed, expected reason to interact with the exact file root blindly appends to.

**Recommended fix (given to the builder brief):** a dedicated root-helper appender, matching the project's established `qmanager_*_apply` convention (`qmanager_ethernet_apply`, `qmanager_timezone_apply`, etc. — see `scripts/etc/sudoers.d/qmanager`), e.g. `qmanager_crash_log_append`:
- Sudoers grant is a bare path, NOPASSWD, no argument restriction — matches the sudoers arg-validation-lives-in-the-helper convention (arg validation lives in the helper, not the sudoers line).
- Helper takes a fixed literal reason arg, hardcode-validated against an enum (e.g. only accepts `"user"` from this call site) — never interpolates request-supplied text into the pipe-delimited log line (avoids breaking the `awk -F'|'` cutoff parser at watchcat line 282, and prevents entry forgery).
- Helper checks `[ -L "$CRASH_LOG" ]` before appending and refuses/recreates as a plain root:root 644 file instead of following a symlink — closes the TOCTOU/symlink hole described above (this is a NEW mitigation, not present in today's watchcat code either — worth a follow-up ticket to harden watchcat's own append the same way, independent of this feature).
- No chmod/chown widening needed at all under this model — crash.log can stay root:root 644, exactly like it implicitly is today between OTA runs.
- Note: trimming to last N entries is currently only done inside watchcat's Tier-4 path (lines 505-513). If www-data-sourced "user" reboot entries can now accumulate between Tier-4 events, the helper should also trim (or a shared trim step needs to run on every append, not just watchcat's).

Also flagged in the same audit (config/OTA items, both CLEARED): new additive files `alert_routing.json`, `last_boot_id`, `reboot_history.json` are safe to seed defaults-on-missing since they have no legacy predecessor — `alert_routing.json` in particular should just be dropped as a new file under `scripts/etc/qmanager/` and picked up for free by the existing "deploy new, don't overwrite existing" loop at `install_rm520n.sh:1177-1188`, no bespoke installer code needed. Discord binary rebuild via the existing `qmanager.tar.gz` path is safe — `qmanager-discord` is already in `UCI_GATED_SERVICES`/`CORE_SERVICES`, `install_file()` ELF-sniffs to skip the CRLF strip, and the `.service` unit has no sandboxing directives that a new command-file watcher would trip.

See also [[project_alert_lib_cgi_basename_collision]] for a second finding from the same audit (item 4, CGI script deletion).
