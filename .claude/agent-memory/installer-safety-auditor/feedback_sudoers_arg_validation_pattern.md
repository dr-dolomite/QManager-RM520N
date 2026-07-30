---
name: feedback_sudoers_arg_validation_pattern
description: This codebase's established sudoers pattern for privileged CGI helpers is a bare command path with NO argument restriction — the helper script's own input validation is the entire security boundary, by design
metadata:
  type: feedback
---

Every existing `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_*` line in `scripts/etc/sudoers.d/qmanager` (confirmed: `qmanager_ethernet_apply`, `qmanager_console_mgr`, `qmanager_tailscale_mgr`, `qmanager_update`, `qmanager_health_check`, `qmanager_set_ssh_password`) grants the bare binary path with **no argument restriction** in the sudoers line itself. `qmanager_ethernet_apply` is the clearest example: sudoers just says `/usr/bin/qmanager_ethernet_apply` (any args), and the script's own `case "$speed_limit" in auto|10|100|1000|2500) ;; *) reject ;; esac` is 100% of the security boundary.

(The only sudoers lines in this file that DO restrict arguments via glob are the systemd-symlink lines — `/bin/ln -sf /lib/systemd/system/qmanager*.service /lib/systemd/system/multi-user.target.wants/qmanager*.service` — and the Custom DNS `/bin/chown radio\:radio /etc/data/dnsmasq.conf`/`/bin/mv ... dnsmasq.conf.new ... dnsmasq.conf` lines, because those invoke generic system binaries (`ln`, `mv`, `chown`) that have no argument validation of their own to lean on.)

**Why:** For a purpose-built helper binary (not a generic system tool), this is an accepted, established pattern here, not a red flag to raise on its own. Sudoers argument-glob restriction is reserved for cases where the invoked command is a generic tool with no self-validation.

**How to apply:** When auditing a new bare-path sudoers grant for a new `qmanager_*` helper, do NOT flag "sudoers can't restrict the arg" as a standalone blocker — that's business as usual here. Instead, audit the HELPER SCRIPT's own input validation as the real security boundary: hard charset whitelist, explicit rejection of `..`/path traversal, content-based validation of the resolved target when the arg selects a file path (e.g. magic-byte check), and confirm the destination write path is itself root-only-writable (so no TOCTOU/symlink-race window exists via an attacker-writable staging directory). Only flag as unsafe if the helper's OWN validation is missing or incomplete — a bare sudoers grant with solid internal validation is the norm, not the exception, in this codebase.
