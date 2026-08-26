---
name: urc-capture-impossible-no-smd11-listener
description: No process holds /dev/smd11 open between qcmd calls, so AT URCs (+QSIMSTAT, +CPIN, etc.) are structurally uncapturable — and enabling one risks interleaving into unrelated qcmd responses
metadata:
  type: reference
---

Nothing on the RM520N-GL keeps `/dev/smd11` open. Verified 2026-08-13 by scanning every `/proc/[0-9]*/fd/*` symlink for `smd11` — **zero hits** while the poller, ping daemon and lighttpd were all running. `atcli_smd11` opens the device per invocation, writes one command, reads to a terminator, and closes.

**Consequence:** any AT feature that reports via *unsolicited result codes* (URCs) is unreadable in the current architecture. `AT+QSIMSTAT=1`, `AT+CREG=2`, `+CMTI` etc. emit into a channel with no attached reader; the line is dropped. There is no URC daemon, no ring buffer, no log — `grep -ri 'URC\|unsolicited' scripts/` returns nothing.

**Second-order hazard:** enabling a URC generator does not just waste effort, it adds risk. A URC emitted *during* another command's read window lands inside that command's response text, and one emitted just before a read can be consumed as the first line of the *next* unrelated command's response. Every poller/CGI parser is `grep '+TOKEN:'`-based so a stray line is usually inert, but `qcmd`'s own `case "$result" in *ERROR*)` classifier and `parse_serving_cell`'s "no +QENG lines" branch are not immune.

`AT+QURCCFG="urcport"` reads `"all"`, and its test form enumerates only `("usbat","usbmodem","uart1","all")` — `smd11` is not a selectable URC port at all.

**How to apply:** when scoping any modem feature described as "notifies you when X happens", check first whether the vendor exposes a *read* form. Recommend the polled read (e.g. `AT+QSIMSTAT?`, which returns `<enable>,<inserted_status>` — the URC's payload is available synchronously) folded into an existing poller tier, and reject the URC path unless the change budget covers a whole new persistent-reader daemon plus re-serializing it against the `/tmp/qmanager_at.lock` flock. Related: [[posh_ssh_connection_recipe]].
