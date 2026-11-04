---
name: root-poller-tmp-flags-unwritable-by-cgi
description: /tmp flags created by the root poller are 644 root:root — www-data CGI cannot overwrite them, so dismiss/ack writes silently fail
type: project
---

Any `/tmp/qmanager_*` flag/state file CREATED by the root poller (`/usr/bin/qmanager_poller`) lands as `-rw-r--r-- root:root` (644). lighttpd runs CGI as **www-data:dialout** (`server.username="www-data"`, `server.groupname="dialout"` in `/usrdata/qmanager/lighttpd.conf`; www-data groups = www-data(33),dialout(20) — NOT root). So a CGI handler that tries to rewrite such a flag (dismiss/ack/toggle) is DENIED at the filesystem level even though it can freely create NEW files in /tmp (1777 sticky).

Confirmed live 2026-07-22 for `/tmp/qmanager_sim_swap_detected` (the "New SIM detected" banner): www-data `test -w` → NOT_WRITABLE, `printf >>` → FLAG_APPEND_DENIED, while general /tmp create → TMP_WRITABLE. The `dismiss_sim_swap` handler in `monitoring/watchdog.sh` does `jq ... > "$FLAG"` then unconditionally `echo '{"success":true}'` with NO write-verification, so the banner re-nags forever.

**Why:** the poller runs as root and owns the file first; CGI is a different, lower-priv user. Ownership, not directory perms, is the gate.

**How to apply:** whenever a CGI endpoint must mutate a poller-created /tmp flag, the write must go through a mechanism that runs as root or a shared-group-writable file — either (a) poller creates the flag group-writable to a group www-data is in (e.g. `chmod 664` + `chgrp dialout`), (b) a root sudo helper does the write, or (c) the CGI signals the poller to flip the field. A bare `> "$FLAG"` in a www-data CGI is a silent no-op. Always verify the write (`[ $? -eq 0 ]` / re-read) before returning success — the unconditional-success pattern hides this class of bug. Testing this as root with `_SKIP_AUTH=1` masks it entirely (root CAN write the file); must test as www-data.
