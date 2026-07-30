---
name: crond-binary-present-but-daemon-dead
description: crond BINARY exists on RM520N-GL (/usr/sbin/crond busybox applet) but the daemon never runs — no systemd unit, empty crontab dir, world-writable spool
type: reference
---

On the live RM520N-GL, the "no crond" premise is subtler than "no cron at all":

- `/usr/sbin/crond` EXISTS (BusyBox applet) and `/usr/bin/crontab` EXISTS. `command -v crond` succeeds. So a naive `which crond` check would FALSELY conclude cron works.
- BUT the daemon is **never started**: no `cron.service`/`crond.service` (`systemctl status` → "could not be found"), nothing under `/lib/systemd/system` or `/etc/systemd/system` references crond, no `/etc/init.d` cron script, no boot wants-symlink, and the installer never starts it. `ps | grep [c]rond` → empty.
- `/var/spool/cron/crontabs/` exists and is **world-writable (drwxrwxrwx)** — so www-data CAN write `/var/spool/cron/crontabs/root` directly (no sudo needed), which is exactly what the CGI scripts do. The write succeeds; the file just sits there dead because nothing reads it. `crontab -l` → "can't open 'root'" (empty).
- No Entware crond either (`/opt/sbin/crond` absent).

**Why it matters:** any feature that installs a crontab entry on this platform silently no-ops — the UI reports success, the file is written, nothing ever fires. Confirm by checking for a RUNNING daemon (`ps | grep [c]rond`) + a systemd unit, NOT just the binary's presence. The project's correct pattern is a runtime-generated systemd `.timer` armed by a root helper (see `qmanager_auto_update_arm`, `qmanager_scenario_schedule_arm`).
