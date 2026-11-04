---
name: reference_rg501q_etc_passwd_not_world_readable
description: /etc/passwd is 0600 root:root on RG501Q-EU (0644 on RM520N-GL) — any by-NAME id/getent lookup by a non-root caller fails there
type: reference
---

**`/etc/passwd` permissions diverge by device**, confirmed live 2026-08-31:
- RM520N-GL: `-rw-r--r-- root root` (0644, world-readable)
- RG501Q-EU: `-rw-------  root root` (0600, root-only)

Consequence: `id -u <name>` / `id -un` / any `/etc/passwd`-by-name lookup
**succeeds only when the caller is root** on the RG501Q-EU. A non-root
caller resolving *its own* uid (`id -u`, `id`, `whoami`) still works fine —
that's `getuid()`, no file read — but resolving a *name* (`id -u www-data`,
or even resolving uid 33 back to a name for display) fails:

- `id -u www-data` as www-data (uid 33) on RG501Q-EU → stderr `id: unknown
  user www-data`, exit 1, empty stdout.
- `id -un` as www-data on RG501Q-EU → stdout `33` then stderr `id: unknown
  ID 33`, exit 1 (BusyBox still prints the numeric uid before failing the
  name resolution).
- Same calls on RM520N-GL succeed and print `www-data` because `/etc/passwd`
  there is world-readable.
- An `awk -F: '$1=="www-data"{print $3}' /etc/passwd` fallback does **not**
  help — it hits the same permission wall and returns empty as non-root on
  RG501Q-EU.

**This broke a real fix.** `qmanager_health_check::t_perm_tmp_writable`
(commit 63bc6a9) added a self-detection branch: `if [ "$(id -u)" = "$(id -u
www-data 2>/dev/null || echo -1)" ]`, intended to skip the privilege
transition when already running as www-data (sudoers refuses www-data as
its own sudo target on both devices). On RG501Q-EU, when actually invoked
as www-data, the right-hand `id -u www-data` throws (permission wall above),
falls back to `-1`, the comparison is `"33" = "-1"` → false → the code takes
the wrong (transition) branch → `sudo -n -u www-data touch` self-target →
sudoers refusal → **false `fail|www-data cannot write to /tmp`** even though
`/tmp` is genuinely writable. This is the exact class of defect the commit
was fixing, reintroduced by a device-specific assumption in the fix itself.
Confirmed via `busybox-portability-checker` Phase 5 validation the same day.

**The only safe self-detection here is a numeric literal**, not a name
lookup: `[ "$(id -u)" = "33" ]` — bypasses `/etc/passwd` entirely (`id -u`
alone is `getuid()`, no file access), and both devices agree www-data is
uid 33 (confirmed via `/etc/passwd` read as root on both). Never resolve
`www-data`'s uid dynamically inside code that might run non-root on the
RG501Q-EU.

See also [[reference_ash_bash_substring_expansion_works]] and the sibling
`+CGCONTRDP` quoting divergence — RG501Q-EU keeps surfacing device-specific
behavior that "measured on RM520N-GL" facts silently assume away.
