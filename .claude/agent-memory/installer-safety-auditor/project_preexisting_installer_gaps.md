---
name: project_preexisting_installer_gaps
description: Known pre-existing (not newly-introduced) installer/sudoers gaps found while auditing unrelated changes — track so they aren't re-discovered from scratch, and re-flag if the touched file changes
metadata:
  type: project
---

Two pre-existing issues found incidentally while auditing the watchcat daemon (2026-07-19), neither introduced by that work, both worth re-flagging if their respective files are ever touched by a future change:

1. **`scripts/usr/bin/qmanager_console_mgr` remounts rootfs `ro` without a preceding `sync`.** Lines 27, 35, 57, 71 all do `mount -o remount,ro / 2>/dev/null || true` directly — no `sync` beforehand. Compare `scripts/usr/bin/qmanager_tailscale_mgr`'s correct `remount_ro() { sync; mount -o remount,ro / 2>/dev/null || true; }` (line 113) and its other inline `sync` + remount-ro call at line 372-373 — that's the idiom every rootfs-writing root helper should follow. `qmanager_console_mgr` writes `$TTYD_BIN` (a downloaded binary) and the `qmanager-console.service` unit to rootfs paths before these remounts; an unflushed write followed by an unexpected power-loss/crash before the next natural `sync` could lose the ttyd binary or unit file. **Fix when this file is next touched:** add `sync` immediately before each of the 4 remount-ro calls.

2. **Sudoers grants `www-data` `/bin/systemctl start *, stop *, restart *, is-active *`** (`scripts/etc/sudoers.d/qmanager` line 5) — this is a genuine wildcard on the unit-name argument, not scoped to `qmanager-*` units the way the boot-persistence `ln`/`rm` rules on lines 8-9 are. As shipped, `www-data` can `sudo systemctl stop sshd` or `stop lighttpd` — broader than the CGI actually needs. This is long-standing, used by `platform.sh`'s `svc_start`/`svc_stop`/`svc_restart`/`svc_is_running` for every qmanager service including watchcat, so no new rule is needed to port the watchdog. Flagging per the standing rule to flag any wildcard sudoers grant — not itself a reason to block unrelated work, but a candidate for tightening (e.g. `/bin/systemctl stop qmanager-*, tailscaled, lighttpd` enumerated explicitly) next time sudoers is revisited.

**How to apply:** don't re-report these as "newly found" in a future audit of a *different* change unless the audit's scope actually touches these files — but do re-verify they're still present (grep for the line) rather than assuming this memory is still accurate, and mention them as pre-existing/out-of-scope context if relevant.
