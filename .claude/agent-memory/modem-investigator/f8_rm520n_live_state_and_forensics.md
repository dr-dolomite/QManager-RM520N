---
name: f8-rm520n-live-state-and-forensics
description: RM520N-GL is fully exposed to F8 (measured 2026-08-25) and /opt there is a bind of /usrdata/opt exactly like RG501Q — plus the two forensic tricks that decide which rc.func branch ran on a boot with no journal
metadata:
  type: reference
---

Measured on the RM520N-GL (serial `61368cd2`) 2026-08-25, pre-fix.

**`/opt` is NOT a dedicated UBIFS volume on RM520N-GL.** It is
`opt.mount` = `What=/usrdata/opt Where=/opt Type=none Options=bind`, so
`/opt` and `/usrdata` both report `/dev/ubi2_0 ... ubifs` in `/proc/mounts`
and `ls /usrdata/opt/etc/init.d/` is byte-identical to `ls /opt/etc/init.d/`.
CLAUDE.md's "Entware opkg at `/opt` (dedicated UBIFS volume)" row is wrong —
it is the *same* ubi2 volume as `/usrdata`, reached through a bind. This is
the same topology as RG501Q-EU, so no `/opt`-shaped divergence exists between
the two devices.

**`opt.mount` is activated by a service, not by a wants-symlink.** There is no
`multi-user.target.wants/opt.mount`; `start-opt-mount.service` (which IS
symlinked) does `ExecStart=/bin/systemctl start opt.mount`. So checking for an
`opt.mount` symlink is a false negative — check `systemctl show opt.mount
-p ActiveState` and the wrapper service instead.

## Two forensic tricks for "did the Entware imposter run?" with no journal

**1. Duration discriminates the rc.func branch.** `rc.func`'s `start()` has two
exits with wildly different costs: the `pidof` short-circuit returns in
milliseconds, while a spawn-then-fail burns a `while ... sleep 1` loop of
`LIMIT=10` (≈11 s). So compare
`systemctl show rc.unslung.service -p InactiveExitTimestampMonotonic
-p ExecMainStartTimestampMonotonic -p ActiveEnterTimestampMonotonic`:
if `ActiveEnter - ExecMainStart` is a few seconds, no S* script failed to
start; if it is >11 s, one did. On the reference boot this was **2.81 s**
(30.055 s → 32.869 s), proving the short-circuit path, not a failed spawn.

**2. The Entware log directory's mtime is a longitudinal "never ran" proof.**
`/opt/etc/lighttpd/lighttpd.conf` sets `server.errorlog =
"/opt/var/log/lighttpd/error.log"` and `server.pid-file = "/opt/var/run/
lighttpd.pid"`, both on the persistent ubi2 volume. lighttpd opens the errorlog
*before* binding, so **any** invocation — even one that dies on a port
collision — creates the file and bumps the directory mtime. `stat
/opt/var/log/lighttpd` still reading the Entware-install date (2026-03-16),
with no `error.log` and no `lighttpd.pid`, is evidence across every boot since
install, not just the current one. Far stronger than anything `ps` can say.

**Related:** [[rc-func-pidof-shortcircuit]] for the mechanism itself.
