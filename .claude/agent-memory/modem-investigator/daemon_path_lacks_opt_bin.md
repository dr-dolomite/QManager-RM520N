---
name: daemon-path-lacks-opt-bin
description: systemd-launched QManager daemons run with a PATH that has NO /opt/bin, while every login shell puts /opt/bin FIRST — so any interactive probe of a dual-provided binary measures the wrong one
metadata:
  type: reference
---

**Measured 2026-09-02 on both devices, from the live processes' own `/proc/<pid>/environ`.**

Two different PATHs are in play and they resolve dual-provided binaries differently:

| Context | PATH |
| --- | --- |
| systemd service (`qmanager-ping`, `qmanager-poller`, …) | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` — **no `/opt/bin`** |
| SSH login shell (what you get via Posh-SSH) | `/opt/usr/sbin:/opt/usr/bin:/opt/sbin:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin` — **`/opt/bin` FIRST** |

Nothing supplies `/opt/bin` to a service: the units carry no `Environment=PATH`
(only `EnvironmentFile=-/etc/qmanager.env`, which holds just `QLOG_LEVEL`), and
`/etc/systemd/system.conf`'s `DefaultEnvironment=` is commented out.
`scripts/etc/profile.d/qmanager-path.sh` prepends `/opt/bin` for **login shells
only** — it never reaches a systemd service.

**Why this bites:** on the RG501Q-EU, `timeout` exists in BOTH trees —
`/opt/bin/timeout` (Entware coreutils, positional form, exits 124) and
`/usr/bin/timeout` (BusyBox **1.29.3**, legacy `-t SECS` form only). A login
shell gets the coreutils one; the daemon gets the BusyBox one. So an
interactive `timeout 3 ping …` succeeds while the identical line inside a
daemon fails with `timeout: can't execute '3': No such file or directory`,
rc=127. RM520N-GL has no `/opt/bin/timeout` at all and its BusyBox is 1.31.1
(positional form supported), so the split is invisible there.

**How to apply:** whenever a daemon behaves differently from your hand-run
reproduction of the same command, reproduce under the daemon's PATH before
anything else:

```sh
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /bin/sh -c \
  'command -v timeout; timeout 3 ping -c1 -W2 1.1.1.1; echo rc=$?'
```

Enumerate a script's whole declared dependency list that way — under the daemon
PATH on RG501Q, `jq awk grep cut date tail mv ping sleep curl flock sms_tool`
all resolve fine inside `/usr/bin` or `/bin`; `timeout` is the only one whose
*resolution* differs from the login shell. That asymmetry is what makes the
failure look impossible: the cache file is still written correctly, so the
telemetry is fresh and confidently wrong rather than absent.

Related: [[posh_ssh_connection_recipe]].
