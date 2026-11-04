---
name: rm520n-loginpw-pam-su-hang
description: RM520N-GL's PAM auth stack uses a proprietary loginpw.so challenge module that makes any non-root `su` block FOREVER when a TTY is present; RG501Q uses stock pam_unix and does not
metadata:
  type: reference
---

`su` on both devices is real shadow-utils (`/bin/su` -> `/bin/su.shadow`, PAM-linked),
NOT a BusyBox applet. `busybox --list` has no `su` on either device.

The auth stacks DIFFER, and that is the whole story:

- **RM520N-GL** `/etc/pam.d/common-auth`: `auth [success=1 default=ignore] loginpw.so`
  — a **Quectel-proprietary** module at `/lib/security/loginpw.so`. It emits
  `quectel-v : v2.0` + `Login info: <base64 challenge>` to the terminal and then
  **blocks on a read with no timeout**. There is no correct answer to type.
- **RG501Q-EU** `/etc/pam.d/common-auth`: `auth [success=1 default=ignore] pam_unix.so nullok_secure`
  — stock. `loginpw.so` is **absent** from its `/lib/security`.

`www-data` is `*` (locked) in `/etc/shadow` on both, shell `/bin/sh`, uid 33.

Measured truth table for `su -s /bin/sh -c CMD www-data`:

| caller | TTY? | RM520N-GL | RG501Q-EU |
| --- | --- | --- | --- |
| root | either | passes instantly (`pam_rootok.so` short-circuits) | passes instantly |
| www-data | no TTY | rc=1 instantly, `su: must be run from a terminal` | rc=1 instantly |
| www-data | TTY | **HANGS FOREVER** in loginpw.so | exits <1s, no hang |

**How to apply:** never run anything containing a non-root `su` from an
interactive SSH shell on the RM520N-GL — it wedges the session and leaves a
setuid-root `su` parked on a pty. Two consequences for probing:

1. A `timeout`/wrapper around `su` does not save you if the wrapper is in a
   pipeline: `sleep N | su ...` measures the sleep, not the su. Launch it
   `setsid ... >file 2>&1 &`, record `$!`, and poll from a SEPARATE
   `Invoke-SSHCommand` so the su can never hold your channel open.
2. `pkill -f 'su -s /bin/sh'` matches YOUR OWN enclosing `sh -c` command line
   and kills your session instead of the stray. Enumerate `/proc/*/cmdline`
   and kill by PID.

To get a TTY on-device for this class of test: `/usr/bin/script -q -c CMD /dev/null`
exists on both (BusyBox applet).

Related: [[posh_ssh_connection_recipe]]
