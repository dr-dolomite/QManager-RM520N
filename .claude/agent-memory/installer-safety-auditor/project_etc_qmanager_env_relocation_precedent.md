---
name: project_etc_qmanager_env_relocation_precedent
description: The canonical, already-shipped solution for "a file under /etc/qmanager must not be www-data-readable/writable" — relocate it to /etc/<name>, never carve it out of the chown; migrate_environment_location() is the reference implementation
metadata:
  type: project
---

**Any secret or root-integrity file under `/etc/qmanager` must be MOVED OUT of that
directory, not permission-pinned inside it.** This is settled project doctrine with a
shipped reference implementation — do not re-litigate it, and do not accept a design
that adds a carve-out to `qmanager_setup`'s chown.

**Why:** The project already tried the carve-out approach for the systemd
`EnvironmentFile` and it failed on live hardware for two independent reasons, both
documented at length in `scripts/install_rm520n.sh:1936-1990`:

1. www-data **owns** `/etc/qmanager` (mode 0755 grants the owner rwx), and
   unlink/replace is governed by the **parent directory's** write permission, not the
   file's mode. So www-data could delete a root:root 0600 file and drop in its own
   regardless of the pin. A root-owned *subdirectory* doesn't help either (www-data
   can rename the subdir away), and the sticky bit doesn't help (its exemption covers
   the directory's owner, which IS www-data).
2. `qmanager_setup:139` runs a bare `chown -R www-data:www-data /etc/qmanager` on
   **every boot** with no exclusion list, so any install-time pin survived exactly one
   boot cycle. Fielded devices were found with the file already www-data:www-data.

`install_rm520n.sh:1333-1344` carries an explicit standing instruction:
> "Do not reintroduce a carve-out here for any file that must not be www-data-writable
> — move it out of `$CONF_DIR` instead."

**Live-confirmed device state (2026-08-04):** `/` 0755 root:root, `/etc` 0755
root:root (unreachable by www-data), `/etc/qmanager` 0755 **www-data:www-data**,
`/etc/qmanager.env` 0644 root:root, `/etc/qmanager/environment` gone (migration
complete on this device).

**How to apply:** When a design needs a file protected *from* www-data, the answer is a
sibling path directly under `/etc` (root:root 0755 — verified unwritable by www-data),
e.g. `/etc/qmanager.env`. Copy `migrate_environment_location()`
(`install_rm520n.sh:1991-2059`) as the migration template — it has every property such a
step needs:
- `[ -f "$src" ] || return 0` early-exit → permanent no-op after first success (idempotent)
- explicit `[ -d "$dst" ]` guard, because `mv file dir` *succeeds* by moving the file
  INSIDE the directory and would then delete the original
- `mktemp` in the **destination** directory `/etc`, not `/tmp` — `/etc` and
  `/etc/qmanager` are the same UBIFS volume (`/dev/ubi2_0`) so `mv` is a true atomic
  `rename(2)`; a `/tmp` temp is tmpfs and degrades to copy+unlink
- `chmod`/`chown` applied to the temp **before** the rename (BusyBox `mktemp` creates
  0600; `mv` carries mode+owner across), so there's no window at the wrong mode
- every failure path `warn`s and `return 0` — the function is called bare from
  `install_backend()` under `set -e`, and aborting mid-OTA with services already
  stopped is worse than degrading
- original removed **only** after copy AND rename both succeed

Note the ordering hazard it documents: relocation must run **after** any older
migration that still reads the OLD path, or that older migration silently becomes a
permanent no-op on devices that still needed it.

Caveat if reusing `/etc/qmanager.env` itself for a secret: it is **0644 world-readable**
and is injected as `KEY=VALUE` into four root daemons that shell out. It is the right
place for *integrity*, the wrong place for *confidentiality* — a secret needs its own
0600 root:root file. See [[project_discord_token_confidentiality_audit]].
