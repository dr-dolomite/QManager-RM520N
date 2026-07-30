---
name: etc-profile-and-login-path
description: /etc/profile.d does NOT exist on stock RM520N-GL; /etc/profile sources it but guarded by [ -d ]; login-shell PATH lacks /opt/bin
type: reference
---

Stock RM520N-GL `/etc/profile.d/` **directory does not exist** out of the box. Any installer that drops a file into `/etc/profile.d/` must `mkdir -p /etc/profile.d` first, or `cp` fails with "No such file or directory" (parent missing).

`/etc/profile` *does* contain the standard sourcing loop, but it is guarded:
```
if [ -d /etc/profile.d ]; then
  for i in /etc/profile.d/*.sh; do [ -f $i -a -r $i ] && . $i; done
fi
```
So a profile.d snippet is **dead weight unless the directory exists** — the `[ -d ]` guard skips the loop entirely when it's absent.

Login-shell PATH on this device (`bash -lc` / `sh -lc`, both read /etc/profile):
`/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin` — **no `/opt/bin`**. So an interactive serial/getty console login genuinely lacks Entware on PATH; that is the real (cosmetic) gap a profile.d snippet is meant to close. SSH/CGI get /opt/bin by other means.

`/etc` is `/dev/ubi2_0` UBIFS mounted `rw` (attr `assert=read-only` but writable — a `touch` in /etc succeeds). `/tmp` is tmpfs. **Why:** confirms /etc writes persist and the profile.d cp failure is purely a missing-parent-dir bug, not a read-only-fs bug.

**How to apply:** when auditing installer writes into /etc/profile.d (or any /etc subdir the vendor doesn't ship), require an explicit `mkdir -p` of the parent.
