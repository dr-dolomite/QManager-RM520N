---
name: systemctl-is-enabled-lib-vs-etc
description: On RM520N-GL systemd 244, `systemctl is-enabled` reports "disabled" for QManager's /lib manual boot symlinks — it only recognizes /etc (config path) symlinks
type: reference
---

`systemctl is-enabled <unit>` on this box keys off WHICH directory the wants-symlink lives in, not merely whether one exists.

- `systemctl enable` creates the symlink in **`/etc/systemd/system/multi-user.target.wants/`** (config search path) → is-enabled reports **`enabled`** (exit 0). Timers land in `/etc/systemd/system/timers.target.wants/`. `enable --now` also starts the unit; `disable --now` reverses both. Verified live 2026-07-20 with a throwaway `/etc/systemd/system/qm-probe-dummy.{service,timer}`.
- QManager's `svc_enable` (`scripts/usr/lib/qmanager/platform.sh:52`) instead symlinks into **`/lib/systemd/system/multi-user.target.wants/`** (the vendor/unit dir). For those symlinks `systemctl is-enabled` returns **`disabled`** (exit 1) even though the unit HAS `[Install] WantedBy=multi-user.target` and boots fine. Verified live: every one of the 11 enabled qmanager units reports `is-enabled=disabled`.

**Backward-compat landmine:** migrating `svc_is_enabled` (which does `[ -L /lib/.../wants/$unit ]`, platform.sh:64) to `systemctl is-enabled` would make EVERY already-deployed, already-enabled qmanager unit report "disabled" — unless `svc_enable` is migrated in lockstep to `systemctl enable` (moving the symlink to /etc) AND existing installs are re-enabled to relocate the symlink from /lib to /etc.

**Why /lib symlinks aren't "enabled":** systemd's is-enabled only counts symlinks in the config path (`/etc`, `/run`); a wants-symlink in the `/lib` unit dir is treated as a vendor default and is-enabled returns disabled regardless of the [Install] stanza.

**Probe safely:** to test enable/disable mechanics without touching real units, create a `Type=oneshot ExecStart=/bin/true` dummy in `/etc/systemd/system/` (RW), daemon-reload, test, then `unlink` + daemon-reload. NEVER enable/disable a real qmanager unit (mutates boot state).
