---
name: tmp-cross-uid-rules-protected-regular
description: Exact kernel truth table for cross-UID /tmp access on RM520N-GL (sticky + fs.protected_regular=1), and why tmp+rename silently defeats qmanager_setup's pre-seeded ownership
type: project
---

RM520N-GL has `fs.protected_regular = 1` **and** `fs.protected_symlinks = 1` (verified live 2026-08-03, `sysctl`), on a `/tmp` that is `root:root 1777` tmpfs. The kernel rule (`may_create_in_sticky()`) allows an `O_CREAT` open of an EXISTING regular file in a world-writable sticky dir only if `file_owner == dir_owner` **or** `caller == file_owner`. There is **no root/CAP override on that check**.

Truth table for `/tmp` (dir owner = root):

| File owner | Caller | `> file` / `>> file` | `rm file` / `mv over file` |
|---|---|---|---|
| root, 0644 | www-data | DENIED (DAC mode) | DENIED (sticky) |
| root, 0666 | www-data | **ALLOWED** (protected_regular exempt: file_owner==dir_owner) | DENIED (sticky — mode never grants unlink) |
| www-data, any mode | root | **DENIED by protected_regular** | allowed (CAP_FOWNER) |
| www-data, 0644 | www-data | allowed | allowed |

So the ONLY shape that works for a file both root and www-data must *write* is **root-owned, mode 0666**. `chmod 0666` never fixes *unlink* — that is the point `apn_apply.sh:33-40` makes.

**Why:** `/tmp` is root-owned sticky tmpfs and protected_regular is on. Verified empirically: `sudo -u www-data test -w /tmp/qmanager_ping.pid` (root 0644) → rc=1; same test on `/tmp/qmanager.log` (root 0666) → rc=0.

**How to apply:**
- `qmanager_setup:57-75` pre-seeds shared /tmp files, but at `:66` it chowns `qmanager_profile_apply.pid` and `qmanager_profile_state.json` to **www-data**, contradicting its own stated strategy two lines above and blocking root by protected_regular.
- **Atomic tmp+rename destroys the pre-seed.** `rename()` replaces the inode, so the new file carries the *writer's* uid and umask (0022 → 0644), not the seeded owner/mode. Live proof: `/tmp/qmanager_profile_state.json` was seeded www-data 0666 at boot yet reads `root:root 0644` minutes later, because `qmanager_profile_apply`'s `write_state()` does `jq ... > "$tmp"; mv "$tmp" "$STATE_FILE"`. Any pre-seed + atomic-write pair is a broken mitigation — re-chown/chmod after every rename, or don't rename.
- When auditing a /tmp flag, always ask *which UID creates it first on this boot*, not which UID is documented as the owner. Related: [[root-poller-tmp-flags-unwritable-by-cgi]].
