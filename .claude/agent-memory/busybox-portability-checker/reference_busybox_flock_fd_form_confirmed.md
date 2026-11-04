---
name: reference_busybox_flock_fd_form_confirmed
description: BusyBox flock (v1.31.1) on RM520N-GL supports the numeric-FD form and read-only-fd exclusive locking, confirmed live 2026-08-12
type: reference
---

Confirmed live on the RM520N-GL (`flock --help`, BusyBox v1.31.1):

```
Usage: flock [-sxun] FD|{FILE [-c] PROG ARGS}
```

This is the **fd-inheritance flock singleton pattern** (`exec 9<file; flock -x -n 9; ( worker & )`)
used by `qcmd` (`/tmp/qmanager_at.lock`) and now by `cell_scan_start.sh` /
`neighbour_scan_start.sh` (`/tmp/qmanager_scan.lock`). All three facts below
were independently verified live, not inferred from `--help` text:

1. **`flock -x -n <numeric-fd>` works** — the FD|FILE union in the usage line is real,
   not just documentation; BusyBox does not silently ignore an FD argument and fall
   through to the FILE/PROG form.
2. **A read-only fd (`exec 9<file`, not `9>file`) is sufficient for `flock -x`.**
   `/proc/$pid/fdinfo/9` showed `flags: 0400000` (O_LARGEFILE only, no O_WRONLY/O_RDWR bit)
   yet `lock: 1: FLOCK ADVISORY WRITE ...` — Linux `flock(2)` exclusive locking does not
   require a write-opened fd, unlike POSIX `fcntl` locks on some platforms. This matters
   because `fs.protected_regular=1` blocks root from write-opening a www-data-owned `/tmp`
   file, so any lock design shared with a future root component must use `<`, not `>`.
3. **fd 9 survives `( cmd & )` backgrounding and outlives the parent's own exit.**
   Verified via `/proc/$child_pid/fd/9` pointing at the lock file immediately after
   backgrounding, and via a second contending shell: `flock -x -n` on the same file
   failed while the backgrounded child held it (even after the *parent* CGI process had
   already exited), then succeeded once the child exited. This is the load-bearing
   mechanism behind [[project_scan_lock_singleton]]-style designs: the lock lives on the
   open file description, not the pid that acquired it.

Also confirmed alongside this same session: BusyBox `sleep` accepts fractional seconds
(`sleep 0.2` measured at a real 0.20s, not truncated/rejected) — BusyBox v1.31.1 sleep
is not the minimal applet some older BusyBox builds ship.

**How to apply:** any future scanner/worker/daemon singleton design that uses
`exec N<lockfile; flock -x -n N; ( worker & )` is sound on this platform — don't
re-derive this from scratch, cite this memory. If BusyBox is ever upgraded/replaced,
re-verify with `flock --help` before trusting this again.
