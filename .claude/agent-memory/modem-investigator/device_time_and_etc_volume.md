---
name: device-time-and-etc-volume
description: Live-device truths about timezone/time handling and the /etc filesystem on RM520N-GL (glibc, zoneinfo location, /etc rw persistent volume, www-data write limits, NITZ defaults)
type: project
---

Live-device platform facts discovered while investigating the timezone-revert bug (probed 2026-07-18). Not derivable from the repo; docs don't capture them.

**libc is glibc 2.31** (`/lib/ld-linux-armhf.so.3 -> ld-2.31.so`, `libc-2.31.so`), NOT musl/BusyBox libc.
- **Why:** the effective timezone mechanism follows glibc rules, not the OpenWRT/musl heritage some scripts assume.
- **How to apply:** glibc reads the `TZ` env var, else `/etc/localtime` (a TZif file/symlink). **glibc IGNORES `/etc/TZ`** — that file is a musl/BusyBox convention and is a dead no-op here. Any code that "persists" tz by writing `/etc/TZ` does nothing on this device. POSIX TZ strings (`PHT-8`, `<+08>-8`, `EST5`) DO work, but only when supplied via the `TZ` env var, not via `/etc/TZ`.

**Zoneinfo database:** `/usr/share/zoneinfo` is EMPTY on stock (rootfs). `timedatectl list-timezones` returns only `UTC`, so `timedatectl set-timezone` fails for any real zone. The real Olson db is **Entware's at `/opt/share/zoneinfo/`** (e.g. `/opt/share/zoneinfo/Asia/Manila` is a valid 422-byte TZif), installed via opkg `zoneinfo-*` packages. Empirically: `TZ=Asia/Manila date` → stays UTC (db missing); `TZDIR=/opt/share/zoneinfo TZ=Asia/Manila date` → +0800 correctly.

**/etc filesystem:** `/etc` is its own **rw persistent UBIFS volume** (`/dev/ubi2_0`, shared with `/usrdata`, `/opt`, `/data`, `/persist`). It is NOT the read-only rootfs (that's ubi0). Writes to `/etc/...` persist across reboot without a remount. BUT `/etc` root is `drwxr-xr-x root:root` — **www-data (CGI user) CANNOT create files directly in `/etc`** (only in chowned subdirs like `/etc/qmanager`). Any CGI operation that must touch `/etc/localtime` etc. needs a root helper via sudo.
- **How to apply:** when a fix needs to write outside `/etc/qmanager`/`/usrdata`/`/tmp`, assume www-data lacks permission and route through the established pattern: a `/usr/bin/qmanager_*` root helper whitelisted in `scripts/etc/sudoers.d/qmanager` (Entware sudoers dir is `/opt/etc/sudoers.d`). This makes such changes Tier 4 (installer-safety-auditor gate).

**Rootfs mount line is misleading — `assert=read-only` is NOT the ro/rw state.** On a device with QManager installed, `mount | grep ' / '` shows `ubi0:rootfs on / type ubifs (rw,relatime,bulk_read,assert=read-only,ubi=0,vol=0)`. The leading `rw` is the real state (the installer runs `mount -o remount,rw /` and it stays rw until reboot); `assert=read-only` is a UBIFS integrity option, not the current mount mode. Don't read `assert=read-only` as "the rootfs is currently read-only" — check the first flag token. On a fresh stock boot (before any install/remount) `/` genuinely is ro. The persistent `/dev/ubi2_0` volume (/usrdata,/etc,/opt,/data,/persist,/cache,/systemrw) is always `rw` and needs no remount; it had ~97M free of 123.7M as of 2026-07-18.

**Modem NITZ is OFF by default:** `AT+CTZU?` → `+CTZU: 0` (auto timezone update disabled), `AT+CTZR?` → `+CTZR: 0`. The modem does NOT re-stamp the system timezone from the network. `AT+CCLK?` tracks system UTC. Rule NITZ out as a cause of tz drift unless someone explicitly enabled CTZU.
