---
name: project_etc_data_layout
description: /etc/data/ filesystem facts — persistence, QCMAP behavior, and safe subdirectory conventions on RM520N-GL
metadata:
  type: project
---

`/etc/data/` is on `/dev/ubi2_0` (UBIFS), the same volume as `/usrdata/`. It is fully persistent across reboots and OTA upgrades. Confirmed by live-device mount output: `/dev/ubi2_0 on /etc type ubifs (rw,...)` and `/dev/ubi2_0 on /usrdata type ubifs (rw,...)`.

QCMAP behavior: rewrites only the `bridge0` runtime file at `/var/run/data/` and specific `dhcp-option-force` fields in `/etc/data/dnsmasq.conf` via targeted `sed`. It does NOT wipe or scan `/etc/data/` subdirectories. There is no evidence of any factory-reset path that removes subdirs of `/etc/data/`.

A shadow copy of factory defaults lives at `/usrdata/etc/data/dnsmasq.conf` — this is a backup only and is not read by the running process.

`/etc/data/` itself is owned `radio:radio` mode `0755`. `www-data` cannot create files there directly (EACCES on create). The approved pattern for www-data writable staging within the same filesystem (for atomic `rename(2)`) is a subdirectory created by the installer with `install -d -o www-data -g www-data -m 0700 /etc/data/qmanager`.

**Why:** `rename(2)` is only atomic within one filesystem. Staging to `/tmp` and moving to `/etc/data/` would be a cross-filesystem copy+unlink, breaking atomicity. The `/etc/data/qmanager/` subdir keeps staging on the same UBIFS volume.

**How to apply:** When any CGI needs to atomically write a file in `/etc/data/`, the installer must create a www-data-owned staging subdir there. Never rely on the parent directory's permissions being sufficient.
