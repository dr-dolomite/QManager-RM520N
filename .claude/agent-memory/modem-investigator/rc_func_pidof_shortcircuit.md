---
name: rc-func-pidof-shortcircuit
description: Entware's rc.func start() short-circuits on `pidof $PROC`, so an S* script silently no-ops whenever a same-named binary is already running — including a transient lighttpd -tt config test
metadata:
  type: reference
---

Entware's `/opt/etc/init.d/rc.func` (sourced by every `S*` script) opens `start()`
with:

```sh
if [ -n "`pidof $PROC`" ]; then
    echo "already running"
    return 0
fi
```

`pidof` matches on **process name only**, with no regard for config file, cgroup,
or which unit owns it. Consequences that have bitten F8:

- `S80lighttpd` sets `PROCS=lighttpd`, and QManager's own server is also named
  `lighttpd`. So the Entware imposter starts **only** if `pidof lighttpd` is
  empty at that instant. This is the real gate — not a port-80 bind race.
- The gate is satisfied by a *transient* process too: QManager's
  `ExecStartPre=/opt/sbin/lighttpd -tt -f ...` is itself named `lighttpd`, so the
  config test acts as an accidental shield for its entire duration.
- Symmetrically, `stop()` does `killall $PROC` — so
  `/opt/etc/init.d/S80lighttpd stop` kills **both** lighttpd instances, not just
  the Entware one. Never suggest it as a surgical fix.
- `S51dropbear` is the exception: it is hand-written, does not source `rc.func`,
  and gates on its own `$PIDFILE` (`/opt/var/run/dropbear.pid`) instead. So the
  dropbear and lighttpd paths are **not** analogous and one cannot be used to
  predict the other.

**How rc.unslung selects scripts** — this settles whether disabling works:

```sh
for i in $(/opt/bin/find /opt/etc/init.d/ -perm '-u+x' -name 'S*' | sort $ORDER )
```

Both `chmod -x` (drops the `-perm -u+x` match) and an `S*`→`K*` rename (drops the
`-name 'S*'` match) are **valid disable mechanisms**. Note it hardcodes
`/opt/bin/find` (GNU findutils, a symlink to `/opt/libexec/find-gnu`), not
busybox find — so a broken Entware findutils silently disables every init script.
