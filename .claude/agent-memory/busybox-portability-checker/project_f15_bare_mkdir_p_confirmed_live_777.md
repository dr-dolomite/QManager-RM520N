---
name: project_f15_bare_mkdir_p_confirmed_live_777
description: F15 audit (2026-08-31) confirmed 3 of the ~11 census bare mkdir -p sites are ALREADY world-writable (777) on both fielded devices, not latent
type: project
---

F15 (tracker item filed 2026-08-26) asked for per-site judgement on the ~11
informational bare-`mkdir -p` sites enumerated by
`scripts/test/installer-persistent-dir-modes.sh` section [5]. On-device
measurement on 2026-08-31 found this is **not a latent risk** — it has
already landed on both fielded devices:

- `install_rm520n.sh:1376` `$BACKUP_DIR` → `/etc/qmanager/backups` — live `drwxrwxrwx root/www-data` on both RM520N-GL and RG501Q-EU (contains `auth.json.*` backup snapshots, individually 0600 but the directory has no sticky bit, so any local writer can delete/replace them)
- `install_rm520n.sh:1626` `/etc/profile.d` — live `drwxrwxrwx root:root` on both devices (root's login shell sources anything dropped here — full root code-exec path)
- `install_rm520n.sh:1838` `/usrdata/qmanager/locales-packs` — live `drwxrwxrwx root:root` on both devices (this is the root-trusted store the `qmanager_language_pack_apply` root helper reads from; world-writable means the validation boundary is bypassable)

**Why**: `docs`/code comment at `install_rm520n.sh:624-627` already states "the
install shell's umask is 0000 on both measured devices" (established by an
earlier task, re: the three Entware bootstrap unit files landing 0666). A
bare `mkdir -p` under umask 0000 creates `0777` directly, and `mkdir -p`
never revisits an existing directory's mode on a later OTA — so once it
lands 777 it stays 777 forever. This is the same root cause as the
`SUDOERS_DIR` defect T3.5 already fixed, just unfixed at 3 more sites.

**Other census sites read safe today but for reasons the code does not
guarantee**: `install_rm520n.sh:315` `install_tree()`'s `mkdir -p "$dst"`
(used for `$CGI_DIR`) measured 755 on both devices — plausibly because `cp -r`
inherits the *source* tree's mode rather than defaulting through a bare
`mkdir`'s 0777, not because anything pins it. `qmanager_tailscale_mgr:145,272`
`mkdir -p /usrdata/root/bin` also measured 755 on both devices, likely because
something else (SimpleAdmin/vendor convention) pre-creates that path before
this script's `mkdir -p` ever runs, making it a no-op onto an already-good
directory — again not something the script itself guarantees.

**Confirmed applet facts (both BusyBox 1.31.1 and 1.29.3, bounded `/tmp` probes)**:
`mkdir -p` on an existing directory is a true no-op (does not touch mode, even
under a different umask on the second call) — `install -d -m 0755` correctly
re-applies its mode every time regardless of ambient umask. Both identical on
both devices.

**How to apply**: any future F-series item touching this installer's directory
creation should treat `$BACKUP_DIR`, `/etc/profile.d`, and
`/usrdata/qmanager/locales-packs` as MUST-FIX (swap to
`install -d -m 0755 ...` — or 0700 for locales-packs since it's meant to be
root-only per its own adjacent comment), not as a hygiene nice-to-have. See
[[reference_tmp_protected_regular_blocks_root]] for the unrelated but
similarly-shaped `/tmp` ownership rule — this defect is `/etc` and
`/usrdata`, a different volume and a different mechanism (umask, not
protected_regular).
