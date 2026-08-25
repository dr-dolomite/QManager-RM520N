# Platform Matrix — per-device facts

> **Applies to:** all supported modems. This document is the single canonical home
> for facts that differ by device. Any doc asserting a device-measured fact should
> link here rather than restating it.

QManager supports two modems. Community-tier devices — RM502Q-AE and other SDX55
parts that run these releases unsupported — deliberately get **no column**; they
are mentioned in prose where a finding came from one, but a matrix that grows a
column per field-sighting becomes unmaintainable at the fourth device.

| | RM520N-GL | RG501Q-EU |
| --- | --- | --- |
| Form factor | M.2 | LGA |
| SoC | SDX65 / SDXLEMUR (X62 silicon) | SDX55 / SDXPRAIRIE |
| `Project Name:` in `/etc/quectel-project-version` | `RM520NGL_VC` | `RG501QEU_VD` |
| `Project Rev :` in `/etc/quectel-project-version` | `RM520NGLAAR03A03M4G_A0.304` | `RG501QEUAAR12A11M4G_04.202` |
| `Branch  Name:` in `/etc/quectel-project-version` | `SDX6X` | `SDX55` |
| `Package Time:` in `/etc/quectel-project-version` | `2026-03-23,12:27` | `2025-02-21,13:43` |
| Status | reference device — everything below measured here | probed 2026-08-24 and 2026-08-25 — see [`rg501q-bringup.md`](./rg501q-bringup.md) and the half-dead-state note below |
| `androidboot.serialno` in `/proc/cmdline` | `61368cd2` | `b7e3d6f1` |

**The label spellings in that table are exact, and three of them are traps.** The
vendor's file is **column-aligned**, not space-delimited: `Project Rev` carries a
space *before* its colon, and `Branch  Name` / `Custom  Name` carry **two** spaces
*between the words*. Captured with `od -c` on both devices 2026-08-24; the two
files are byte-identically formatted.

A parser written against the obvious spelling matches nothing. That is not
hypothetical — `qmanager_poller`'s `grep -m1 "^Branch Name"` (one space) has
matched on **no device, ever**, so `detect_orientation_from_soc()` has always
fallen through to `normal`. Any new reader must tolerate whitespace *between the
words*, not merely before the colon:

```sh
grep -m1 '^Branch[[:space:]]*Name[[:space:]]*:' "$f" | sed 's/^[^:]*:[[:space:]]*//'
```

`scripts/usr/lib/qmanager/hw_profile.sh` is the shared implementation — use it
rather than writing a fourth ad-hoc `grep`. Its test fixtures in
`scripts/test/hw-profile.sh` are base64 round-trips of the real bytes from both
devices, with the capture commands recorded in the header, so the exact file
contents need not be re-probed.

## Device access — both devices are reachable over SSH, at distinct addresses

**Updated 2026-08-25.** Two things changed on the RG501Q-EU that between them
retire every "adb is the only path" and "they collide on one IP" note below:

| | RM520N-GL | RG501Q-EU |
| --- | --- | --- |
| Address | `192.168.225.1` (stock default) | **`192.168.120.1`** — changed manually, see [`lan-gateway-ip.md`](./lan-gateway-ip.md) |
| Transport | SSH | **SSH** — same user and password as the RM520N-GL |
| `.env` vars | `RM520N_IP` / `RM520N_SSH_USER` / `RM520N_SSH_PASSWORD` | `RG501Q_IP` / `RG501Q_SSH_USER` / `RG501Q_SSH_PASSWORD` |
| Serial | `61368cd2` | `b7e3d6f1` |

The bare `MODEM_*` triad is kept as an **alias for the RM520N-GL** so existing
briefs and docs keep working; prefer the prefixed names in anything new.

**Two consequences worth stating plainly:**

1. **The address collision is gone.** Both devices previously answered on
   `192.168.225.1` — that was the RM520N-GL's `MODEM_IP` *and* the RG501Q-EU's
   `bridge0` address — so they could not share the host's Ethernet, and an IP
   alone never told you which one replied. Distinct subnets end that.
2. **Simultaneous access is DEMONSTRATED as of 2026-08-25.** Both devices were
   reached from the same host minutes apart on that date, each with its identity
   proven from `/proc/cmdline` (`61368cd2` and `b7e3d6f1`). The earlier note here
   — host holding `192.168.120.34` with no `192.168.225.x` address, RM520N-GL
   offline — described a transient host-addressing state, not a standing limit.

   Removing the collision was necessary but not sufficient: the host must hold an
   address on **both** subnets at once, and that still does not happen by itself.
   So **check reachability rather than assuming it** — expect to need a second
   interface or a manually added route, and remember either device may simply be
   powered down.

This matters for `change-workflow.md`'s *device-diff before agents* rule, which
assumes comparing the two is cheap. Every cross-device defect found so far
(`wget`, `timeout`, `mountpoint`) came from exactly that comparison and none from
reading code — so if the two devices cannot be reached in one session, that rule
degrades to a cable swap and the divergences go back to hiding.

**Still prove identity before recording a capture.** The collision is gone, but a
wrong-device capture is silent and the cost of the check is two commands:

```sh
cat /etc/quectel-project-version   # Project Name: RM520NGL_VC | RG501QEU_VD
grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline   # 61368cd2 | b7e3d6f1
```

> **Historical note.** Entries below dated 2026-08-24/25 were captured over
> **adb**, which at the time was the RG501Q-EU's only shell — and was itself lost
> for part of that period when a factory reset reverted the USB composition
> (PID `0x0801` → `0x0800`, the ADB interface gone). Those measurements remain
> valid; only the *transport* they name is obsolete. SSH verified working
> 2026-08-25: `RG501QEU_VD` / `SDX55` / serial `b7e3d6f1` / BusyBox 1.29.3,
> QManager `v0.1.14-draft` installed.

## ⚠️ The RG501Q-EU is in a half-dead state (as of 2026-08-25)

The user factory-reset the device on **2026-08-25**. The reset wiped **only the
userdata volume** (`/dev/ubi2_0` — which backs `/etc`, `/usrdata` **and**
`/opt`). It did **not** touch the firmware image (`ubi0:rootfs`, mounted `ro`).

QManager installs binaries into `/usr/bin` and units into
`/lib/systemd/system` — both on the rootfs — so **the previous owner's v0.1.12
install survived the reset and is still running**, while its entire
configuration and the whole Entware tree are gone.

Consequence for this table: some 2026-08-25 measurements describe **that broken
state**, not stock firmware. Every RG501Q-EU cell below is therefore tagged as
one of:

- **stock firmware** — a property of the shipped image; portable to a clean device.
- **post-reset state** — an artifact of the wipe; will change once Entware and
  QManager config are reinstalled. Never generalize one of these.

A third class appeared later the same day: cells measured **after a live full
installer run on 2026-08-25** (the Entware bootstrap fix — see the `wget` section
under Shell & toolchain). Those describe a *correctly installed* device, and they
supersede the matching post-reset cell rather than the stock-firmware one.

## How to read this document

**A cell stays `*unverified*` until the hardware is probed.** Phase A0 recorded
provenance and never invented a measurement. The first RG501Q-EU probe ran
**2026-08-24** over adb — full results, including the GFW/GitHub finding that
reframed the work, are in [`rg501q-bringup.md`](./rg501q-bringup.md). A second
read-only adb probe (serial `b7e3d6f1`) ran **2026-08-25 01:13–01:19 UTC** over a
single boot; cells filled from it carry `adb 2026-08-25` in `How established`.
Everything still reading `*unverified*` was not covered by either probe.

`How established` distinguishes a live measurement from an inference. Treat
`inferred` rows with the same suspicion as an unverified one: they are reasoning
about the device, not observation of it.

## ⚠️ The recurring mistake: "does the NAME resolve?" vs "does the THING behave?"

**Read this before adding a third device.** Three separate defects found while
bringing up the second one share a single mistake — a guard that asks whether a
command *name resolves* when what actually matters is whether the thing behind
that name *implements the interface the code assumes*:

| Guard | What it asked | What mattered | Status |
| --- | --- | --- | --- |
| `! command -v wget` | is there a `wget`? | does anything on this device download over HTTP? BusyBox 1.29.3 ships **no `wget` applet** | fixed in `219f3e6` |
| `command -v timeout` | is there a `timeout`? | which of two incompatible CLIs does it accept? BusyBox always provides the applet, so this **always succeeded** and the Entware package was never installed on either device | fixed in `26f5c31` |
| `mountpoint -q /usrdata` | *(implicitly)* is `/usrdata` a mount? | `mountpoint` is **absent** on the RG501Q-EU, so the shell's exit **127** is read as the boolean "not a mount" | **open — F6** |
| `! command -v curl` | is a `curl` reachable *right now*? | is it reachable from the PATHs the **callers** get? The installer prepends `/opt/bin` to its own PATH, so this finds Entware's curl, concludes "already reachable", and skips the `/usr/bin/curl` symlink — leaving it unreachable to CGI and `sudo -n` helpers, whose PATH has no `/opt/bin` | **open — F1**, dormant: both known devices ship a factory `/usr/bin/curl` |

`command -v` answers a question about the **filesystem**. Nearly every guard that
uses it wants an answer about **behaviour**. On a one-device fleet the two happen
to coincide, which is why none of these surfaced for years: the RM520N-GL has a
`wget`, has a positional `timeout`, and has `mountpoint`, so "the name resolves"
and "the thing behaves" gave the same answer every time.

The rules that fall out of it:

- **Probe behaviour, not presence.** Run the tool the way the code will and check
  the result — `timeout 1 true` and look for 127, not `command -v timeout`.
  `qm_timeout` in `scripts/usr/lib/qmanager/platform.sh` is the reference
  implementation.
- **Never read a missing command's exit 127 as a value.** `127` from the shell
  means "I could not run this", which is not `false`. Separate the two: check the
  command exists *and* branch on its real exit status.
- **A version number is not an interface.** BusyBox 1.29.3 vs 1.31.1 differ in
  `timeout`'s *argument position*, which no applet list and no flag battery can
  see. Only running it can.

---

## Boot & time

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Battery RTC | None — every boot starts at Jan 1970 | *unverified* | on-device 2026-07 · `scheduled-timers.md` |
| Clock step at boot | `ql_time_daemon` steps ~24s in; requires a registered SIM (no SIM ⇒ 1970 forever) | *unverified* | on-device 2026-07 · `scheduled-timers.md` |
| `OnCalendar` timer behavior | Every armed timer misfires **twice** per boot (~23s at 1970, ~29s post-step) | *unverified* | on-device, reproduced across 2 boots · `scheduled-timers.md` |
| `crond` | Binary ships but daemon never runs; `/var/spool/cron/crontabs/` empty | *unverified* | on-device, re-confirmed twice · `scheduled-timers.md` |
| `systemd-time-wait-sync` | Not shipped | *unverified* | on-device · `scheduled-timers.md` |
| journald | Disabled device-wide — use `/var/log/messages` | *unverified* | on-device · `scheduled-timers.md` |
| systemd version | 244 (minimal build; `systemctl is-enabled` reads only `/etc/systemd/system/`) | Version *unverified*; the `is-enabled` behavior **reproduces** — 13 `qmanager-*.service` units report `disabled` yet start every boot | RM520N-GL: on-device · `qmanager-independence.md`. RG501Q-EU: adb 2026-08-25 (serial `b7e3d6f1`) — stock firmware behavior, observed via a post-reset install |

> ℹ️ NOTE: **`disabled` does not mean "will not start."** QManager's units live in
> `/lib/systemd/system/` and their start symlinks in
> `/lib/systemd/system/multi-user.target.wants/` — deliberate, because the rootfs
> boots `ro` and `/etc/systemd/system/` is where `systemctl enable` would want to
> write. This minimal systemd build reads only `/etc/systemd/system/` when
> answering `is-enabled`, so it reports `disabled` for units it then starts on
> every boot. Confirmed on **both** devices; check the `.wants` symlink, not
> `is-enabled`. Tracked as **F12** below, including why moving the symlinks into
> `/etc/systemd/system/` is not the fix.

## Filesystem & partitions

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Rootfs | `ubi0:rootfs`, boots **`ro`** — proof is `ro` in `/proc/cmdline`, not `/proc/mounts` | **Same** — `/proc/cmdline` carries `ro`, `root=ubi0:rootfs`, `rootfstype=ubifs`, `ubi.mtd=30 ubi.mtd=25` | RM520N-GL: on-device · `qmanager-independence.md`. RG501Q-EU: adb 2026-08-25 (`b7e3d6f1`) — stock firmware |
| `/etc` + `/usrdata` + `/opt` | Same UBIFS volume `ubi2_0`, always rw, no remount needed. `/opt` is **not** a volume of its own — it is a bind of `/usrdata/opt` (`opt.mount`: `What=/usrdata/opt`, `Type=none`, `Options=bind`), so `/proc/mounts` shows `/dev/ubi2_0` on both `/usrdata` and `/opt` | **Same** — `/dev/ubi2_0` backs `/usrdata`, `/etc` **and** `/opt`, all `ubifs rw,relatime,bulk_read`, with `/opt` bound from `/usrdata/opt` exactly as on the RM520N-GL. **No `/opt`-shaped divergence between the two devices** | RM520N-GL: reboot-proven 2026-08-10; `/opt` bind measured 2026-08-25 (`/proc/mounts`, the `opt.mount` unit, and byte-identical `ls -la /usrdata/opt/etc/init.d/` vs `/opt/etc/init.d/`). RG501Q-EU: adb 2026-08-25 `/proc/mounts` — stock firmware |
| `/tmp` | tmpfs, `root:root 1777`, ~89 MB, cleared every boot | `tmpfs rw,nosuid,nodev` and **exec-capable** (a `chmod +x` script in `/tmp` ran); mode and size *unverified* | RM520N-GL: on-device · `tmp-file-ownership.md`. RG501Q-EU: adb 2026-08-25, probe file removed — stock firmware |
| adb shell UID | n/a (SSH) | `uid=0(root)` | adb 2026-08-25 — stock firmware |
| ⚠️ `fs.protected_regular` | **`=1`** — blocks **root** (not www-data) from write-opening another UID's file in a sticky dir | ⚠️ **`=0`** — a genuine divergence. The whole cross-UID `/tmp` contract in [`tmp-file-ownership.md`](./tmp-file-ownership.md) **does not engage on this device**: root can write a www-data-owned file in `/tmp` freely. The `root:root 0666` seeding in `qmanager_setup` is therefore *redundant* here rather than load-bearing — do not read a working RG501Q-EU as evidence that a seeding mistake is harmless, because the same code on the RM520N-GL will fail silently | RM520N-GL: on-device · `tmp-file-ownership.md`. RG501Q-EU: adb 2026-08-25 · `rg501q-bringup.md`, re-confirmed over SSH 2026-08-26 (`sysctl fs.protected_regular`, serial `b7e3d6f1`) |
| `fs.protected_symlinks` | `=1` | `=1` | Both: commit `e079004` (measured on both devices 2026-08-26); RG501Q-EU re-confirmed over SSH the same day |
| Cross-FS `mv` | `/tmp`→`/etc` gets `EXDEV`; degrades to copy+unlink | *unverified* | inferred from the volume split above |
| `pid_max` | 32768; PID churn ~100/s ⇒ wraps in ~325s | *unverified* | on-device · `tmp-file-ownership.md` |

> ⚠️ WARNING: **`fs.protected_symlinks=1` is not protection for `/etc/qmanager`.**
> Both devices have the sysctl enabled, and it is irrelevant there: it engages
> only for **world-writable sticky** directories such as `/tmp`, and
> `/etc/qmanager` is `0755` and **not sticky**. A symlink-redirect attack against
> a root helper writing into that directory was reproduced live on **both**
> devices *with the sysctl on* (commit `e079004`). "The sysctl is on" reads as
> protection and is not — see
> [qmanager-independence.md](qmanager-independence.md#-any-root-helper-writing-into-etcqmanager-with-a-plain--is-redirectable).

## Shell & toolchain

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| BusyBox | v1.31.1 | **v1.29.3** (older — factory build 2025-02-21) | RM520N-GL: on-device · `auth-rate-limiting.md`, re-confirmed 2026-08-25. RG501Q-EU: adb 2026-08-24 · `rg501q-bringup.md` — stock firmware |
| BusyBox `tr -d '\000-\037'` | Works correctly on 1.31.1 | *unverified* | on-device 2026-08-25 |
| `flock -w` (timeout) | **Absent** — poll `flock -x -n` in a loop instead | *unverified* | on-device · `at-command-transport.md` |
| `flock` bare-FD form | Supported; a read-only fd suffices for `-x` | *unverified* | on-device via `/proc/<pid>/fdinfo` |
| Fractional `sleep` | Supported | *unverified* | on-device · `speedtest.md` |
| `/bin/bash` | Present, 3.2.57 — many modern bashisms missing | **Present** at `/bin/bash`; version *unverified* | RM520N-GL: on-device · `docs/BACKEND.md`. RG501Q-EU: adb 2026-08-25 — stock firmware |
| `/bin/sh`, `tr`, `lighttpd` | *unverified* as a set (all three are used repo-wide) | **Present** — `/bin/sh`, `/usr/bin/tr`, `/usr/sbin/lighttpd` | RG501Q-EU: adb 2026-08-25 — stock firmware |
| `curl` | *unverified* | **Stock at `/usr/bin/curl`** — 7.61.0 (`arm-oe-linux-gnueabi`), libcurl/7.61.0 GnuTLS/3.6.4 zlib/1.2.11 libidn2/2.0.5, Release-Date 2018-07-11 | RG501Q-EU: adb 2026-08-25 — stock firmware |
| ⚠️ `wget` | **Present** at `/usr/bin/wget` — a BusyBox applet symlink, so it exists because 1.31.1 was built *with* the applet | ⚠️ **Absent entirely** — BusyBox 1.29.3 was built **without** the `wget` applet, and no standalone `wget` binary ships. `curl` is the only downloader. **Post-install**, QManager supplies one: Entware `wget-ssl` (GNU Wget 1.25.0) at `/opt/bin/wget`, symlinked to `/usr/bin/wget` | RM520N-GL: on-device 2026-08-25 (post-fix no-op check). RG501Q-EU: adb 2026-08-24 and 2026-08-25 — stock firmware; the post-install state from a live installer run 2026-08-25 |
| ⚠️ `timeout` CLI form | BusyBox 1.31.1 — **positional only**: `timeout SECS PROG`. `timeout -t 2 echo hi` → `invalid option -- 't'`, exit 1 | ⚠️ BusyBox 1.29.3 — **`-t` only**: `timeout -t SECS PROG`. `timeout 2 echo hi` → `can't execute '2'`, exit **127**, and the command **never runs** | on-device 2026-08-25, both devices, behaviour battery · see the `timeout` section below |
| `/opt/bin/timeout` (Entware `coreutils-timeout`) | **Absent** — the package was never installed here either (see the detector note below) | **Present as of 2026-08-25**, installed by the fixed installer. A symlink to `/opt/libexec/timeout-coreutils`; accepts the positional form and returns the GNU 124 on a deadline kill | on-device 2026-08-25 (RM520N-GL check strictly read-only) |
| `mountpoint` | Present at `/bin/mountpoint` | ⚠️ **Absent entirely** — no BusyBox applet, no standalone binary. Open defect **F6** (see below) | on-device 2026-08-25 |
| `getent` | **Absent** | **Absent** | on-device 2026-08-25, both devices |
| `xmlstarlet` (`/opt/bin/xml`) | Not installed by default (see the doc note below) | **Absent** — checked directly, and no Entware `.control`/`.list` for it either | RM520N-GL: `docs/BACKEND.md`. RG501Q-EU: adb 2026-08-25 — post-reset state |
| `xmllint` (`/usr/bin/xmllint`) | System-bundled | **Absent** — no `/usr/bin/xmllint`, and no BusyBox `xmllint` applet (`applet not found`) | RM520N-GL: `docs/BACKEND.md`. RG501Q-EU: adb 2026-08-25 — post-reset state; unverified whether stock (pre-reset) firmware ships one |
| `printf %q` | **Fails** | **Fails** | on-device 2026-08-25, both devices — not a divergence, just never available |
| `lighttpd` | Entware only, `/opt/sbin/lighttpd` — no vendor build | **Two of them.** Vendor `/usr/sbin/lighttpd` ships in the stock image; QManager still installs and uses the Entware build at `/opt/sbin/lighttpd`. The vendor binary is left in place, unused | RG501Q-EU: adb 2026-08-24 · `rg501q-bringup.md` — stock firmware |
| `/opt/sbin` | Created by the `entware-opt` package | **Does not exist** before Entware is bootstrapped; the installer now creates it up front (`dropbear.service` hardcodes `ExecStart=/opt/sbin/dropbear`) | RG501Q-EU: adb 2026-08-25 with `/opt` empty — **post-reset / pre-bootstrap state** |
| CA bundle | *unverified* | `/etc/ssl/certs/ca-certificates.crt`, 200061 bytes, dated Feb 21 2025 | RG501Q-EU: adb 2026-08-25 — stock firmware |
| Shell arithmetic | BusyBox `sh` is 32-bit signed (wraps past 2.15 GB); bash 3.2 is 64-bit | *unverified* | on-device · `data-usage-counter.md` |
| Entware `jq` | `/opt/bin/jq` 1.7.1, built **without** ONIGURUMA — `gsub`/`test`/`match` abort at runtime | **Installed 2026-08-25** by the fixed installer; whether this build carries ONIGURUMA is still *unverified* — do not assume it matches the RM520N-GL row either way | RM520N-GL: on-device · `alerts.md`, re-confirmed 2026-08-25. RG501Q-EU: installed by a live installer run 2026-08-25; regex support not probed |
| `opkg` / Entware tree | `/opt/bin/opkg`. **Not a dedicated volume** — `/opt` is a bind of `/usrdata/opt` on `ubi2_0` (measured 2026-08-25; an earlier claim of a dedicated UBIFS volume here was wrong), so a factory reset wipes it | **Bootstrapped 2026-08-25** — 44 packages, after the installer fix below. Before that fix `/opt` held only a half-written `opkg` and zero packages. Same bind topology as the RM520N-GL: `/opt` is a bind of `/usrdata/opt` on `ubi2_0`, so a factory reset wipes it | RM520N-GL: on-device 2026-08-25 (`/proc/mounts` + the `opt.mount` unit + content identity). RG501Q-EU: adb 2026-08-25 — **post-reset state**, then a live full installer run the same day |
| `sftp-server` | Absent — deploy with `scp -O` only | *unverified* | on-device |
| `stdbuf` | Absent | *unverified* | on-device · `qmanager-independence.md` |
| Vendor default `PATH` | `/opt/usr/sbin:/opt/usr/bin:/opt/sbin:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin` — **`/opt/bin` precedes `/usr/bin`** in the shipped login environment, not merely in QManager's own prepends | Assumed identical; *unverified* | RM520N-GL: on-device 2026-08-25 |
| `PATH` inside systemd units | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` — **no `/opt/bin` at all**, because no shipped unit sets `Environment=PATH=` | Assumed identical; *unverified* | RM520N-GL: on-device 2026-08-25 |
| ⚠️ `PATH` delivered to a `sudo -n` root helper | Assumed identical; *unverified* | **`/bin:/usr/bin`** when a `www-data` CGI invokes a helper as `setsid sudo -n …` — **no `/opt/bin`**. Installing an Entware binary therefore does **not** make it reachable from the privileged path; resolve by absolute path | RG501Q-EU: on-device 2026-08-25 as `www-data` |

### ⚠️ No `wget` means no Entware — the bootstrap chicken-and-egg

**Short version: Entware's `opkg` downloads packages by shelling out to `wget`, and
that choice is compiled in — so on a device with no `wget`, `opkg` can fetch
nothing at all, including a `wget` to fix itself with.**

The mechanism: `opkg` (the Entware package manager, an OpenWrt descendant) does not
speak HTTP itself. It builds a command line and hands it to an external downloader.
On the Entware build QManager installs — version `d038e5b6`, dated 2022-02-24 —
that downloader is hardcoded: there is **no `option downloader` line in
`/opt/etc/opkg.conf`, and no such string anywhere in the binary**, so `curl` cannot
be selected by configuration.

Consequences measured on the RG501Q-EU before the 2026-08-25 installer fix:

- Every `opkg` fetch failed, so **every** Entware package was skipped — `lighttpd`,
  `sudo`, `jq`, `dropbear`.
- The installer still **exited 0** and warned about connectivity. That was an active
  misdiagnosis: `curl` pulled the identical URL
  (`http://bin.entware.net/armv7sf-k3.2/Packages.gz`) seconds later with HTTP 200 and
  381792 bytes. The network was fine; the downloader was missing.
- Downstream, no `sudo` meant the sudoers rules were skipped, so CGI privilege
  escalation could never work.

The installer now writes a **temporary curl-backed `wget` shim** when
`command -v wget` fails, uses it to bootstrap Entware, then installs the real
`wget-ssl 1.25.0-4` from Entware as the permanent handoff. The RM520N-GL, which
ships a real `wget`, never takes that path.

> ⚠️ **The shim is deliberately non-persistent — never move it to `/opt/bin`.** It
> lives in `/tmp` for the duration of `install_dependencies()` only. Two reasons,
> both in the two `PATH` rows above and in `uninstall_rm520n.sh:7`: `/opt/bin`
> precedes `/usr/bin` in the vendor default `PATH`, so an `/opt/bin/wget` would
> **shadow the real system `wget`** for the CGI backend, the OTA downloader and every
> root helper; and the uninstaller deliberately never removes anything under `/opt`,
> so that shadow would outlive QManager itself.

> ℹ️ NOTE: **OTA cannot deliver this fix.** `qmanager_update` always invokes the
> installer with `--skip-packages` (`scripts/usr/bin/qmanager_update:260,464,576,651`)
> and `install_dependencies()` is gated behind `DO_PACKAGES`
> (`scripts/install_rm520n.sh:3426`), so a Software Update never runs the bootstrap at
> all. A device stranded in the half-bootstrapped state needs a **fresh full installer
> run**. This was an explicit scoping decision, not an oversight.

### Why the Entware `lighttpd` is installed even though a vendor one exists

The RG501Q-EU ships `/usr/sbin/lighttpd`, so installing Entware's build looks
redundant. Keeping the Entware build is an **approved decision**, for RM520N-GL
parity: QManager's `lighttpd.conf`, its TLS certificate paths and the
`mod-cgi` / `mod-openssl` / `mod-redirect` / `mod-proxy` module set are all built
against the Entware lighttpd, and lighttpd refuses to load a module whose version
does not match the server's (`plugin-version doesn't match`). Pointing QManager at
the vendor binary would mean sourcing a matching module set for it on every device.
The vendor binary stays on disk, unused.

### ⚠️ `timeout` — the second load-bearing applet divergence

**Short version: BusyBox changed `timeout`'s command line in release 1.30, the two
devices sit either side of that change, and no single literal invocation works on
both.** Before 1.30 the seconds value was an *option* (`-t SECS`); from 1.30 it is
the *first positional argument* and `-t` was removed.

| Invocation | RG501Q-EU (BusyBox 1.29.3) | RM520N-GL (BusyBox 1.31.1) |
| --- | --- | --- |
| `timeout 2 echo hi` | `can't execute '2'` → exit **127**, no output | works |
| `timeout -t 2 echo hi` | works | `invalid option -- 't'` → exit 1 |

The 127 case is the dangerous one: BusyBox 1.29.3 tries to *exec the number* as
the program, so the command being wrapped **never runs at all** and the caller
sees a failure that looks like the command's own. Two real misdiagnoses came from
this, both on a device where nothing was actually wrong:

- the installer's `at_stack_check` reported "AT device not responding" on a
  healthy AT stack;
- `qmanager_health_check` reported DNS as a hard failure while `nslookup`
  resolved the same name correctly a second later.

**The root cause of the root cause was the detector, not the syntax.**
`install_rm520n.sh` guarded its `coreutils-timeout` install with
`command -v timeout`, which always succeeds — BusyBox ships the applet on both
devices — so the Entware package was **never installed on either device**. See
[the recurring mistake](#️-the-recurring-mistake-does-the-name-resolve-vs-does-the-thing-behave)
above.

The fix is `qm_timeout SECS COMMAND [ARGS...]`. Callers always write the
coreutils (positional) form and the wrapper dispatches. Its three rules, and why
each one is not optional:

1. **Probe behaviour, once, at load** — run `timeout 1 true` and check for exit
   127. 127 means this build could not exec `1` as a program, i.e. it wants the
   legacy `-t` form. Never `command -v`.
2. **Resolve by absolute path** (`/opt/bin/timeout`, then `/usr/bin/timeout`),
   never `$PATH` — a root helper invoked as `setsid sudo -n …` receives
   `PATH=/bin:/usr/bin` (measured, see the table above), so a `$PATH` lookup
   would miss an Entware `timeout` for exactly the caller that needs it.
3. **Normalise a deadline kill to exit 124.** GNU coreutils hardcodes 124 when
   *it* enforces the deadline; BusyBox just relays the killed child's wait status
   (SIGTERM → 128+15 = **143**). Because neither device shipped
   `coreutils-timeout`, `qmanager_health_check`'s `rc = 124` "DNS timed out"
   branch had been dead on **both** devices for its entire existence. Do not
   "simplify" the remap away.

`qm_timeout` lives canonically in `scripts/usr/lib/qmanager/platform.sh`, with two
deliberate local copies (`install_rm520n.sh`, `qmanager_health_check`) pinned
against drift by `scripts/test/timeout-portability.sh`. The contract and the
reasons for the copies are in
[`qmanager-independence.md`](./qmanager-independence.md#the-timeout-contract).

### The applet census — done once, so nobody repeats it

A full `busybox --list` diff between the two builds, plus a behaviour battery over
**every flag QManager actually passes**, ran 2026-08-25 on both devices. The
result is narrower than the version gap suggests:

- **Availability differs by exactly four applets**: `wget` and `mountpoint` (both
  have call sites and both are covered above), plus `i2ctransfer` and `ts` (**zero
  call sites** — noted only so a future diff does not look unexplained).
- **Every flag QManager passes behaves identically on both builds.** `timeout` is
  not on that list because the divergence is in *argument position*, not a flag.
- `printf %q` fails on both — not a divergence.
- `grep -P`, `find -newermt`, `sort -V` and `readlink -f` have **zero call sites**,
  so their portability was not investigated. Adding a first call site means
  probing them first.

> ℹ️ NOTE: The census covers applet *availability* and *flag* behaviour. It does
> not cover argument-*position* changes like `timeout`'s, which a flag battery
> cannot see. A third device needs the behaviour probe, not the applet list.

### F6 (open) — the `mountpoint` guard misreads a missing command

`install_speedtest_cli()` in `scripts/install_rm520n.sh` guards its work with:

```sh
if ! mountpoint -q /usrdata 2>/dev/null; then
    warn "/usrdata is not a mounted filesystem — skipping speedtest CLI install"
    return 0
fi
```

On the RG501Q-EU `mountpoint` does not exist, so the shell returns **127** — "no
such command" — and the guard reads that as the boolean "not a mount", silently
skipping the Speedtest CLI install on a device where `/usrdata` **is** a mount.
This is the same family as the `wget` and `timeout` detectors, with one extra
step: it treats a missing command's exit 127 as meaningful data. **Still open**,
tracked as F6; recorded here so the availability fact and the defect stay
together.

### F8 (fixed 2026-08-25, `952309e`) — Entware's `S80lighttpd` can take port 80 before QManager's own server does

**Short version: two different lighttpd web servers are installed on the device, and
Entware's copy decides whether to start by asking "is any process named `lighttpd`
running right now?". On a boot where the answer happens to be no, Entware's server
binds port 80 first, serving an empty folder with no HTTPS — so the QManager UI is
unreachable until someone intervenes over SSH.** The fix clears the executable bit
on Entware's start script so it can never run. Validated on the RG501Q-EU across
three reboots; the RM520N-GL is now **measured exposed** as well — all four
preconditions present, the defect observed firing and being won by accident on the
boot that was captured — and has had the fix applied by hand and **reboot-validated
2026-08-25** (see
[RM520N-GL status](#rm520n-gl-status-confirmed-exposed-latent-now-fixed) below, and
read the caveat on what that reboot does *not* prove).

> ⚠️ **The original filing of this defect described the wrong mechanism.** It said
> the two servers "race as peers for port 80" on "every boot", a coin flip. That is
> not what happens, and it was `n=1` — a single observed failure, generalised. The
> corrected mechanism is below; the corrected frequency is **intermittent**, with a
> measured `n=2` (one loss, one win, byte-identical config on disk).

#### The actual mechanism — a process-name check, not a port collision

`/opt/etc/init.d/S80lighttpd` is four lines that source `/opt/etc/init.d/rc.func`.
That shared helper's `start()` — read verbatim on-device — is:

```sh
if [ -n "`pidof $PROC`" ]; then   # PROC=lighttpd
    echo "already running."
    return 0
fi
```

`pidof` matches on the process **name** only. It cannot tell QManager's lighttpd
from Entware's, and it cannot tell a long-running server from a transient
config-test child that will exit a second later. So the two servers **never both
attempt to bind** — there is no port contention at any point. The outcome is
decided entirely by whether *any* process called `lighttpd` exists at one instant:
`rc.unslung.service` start, plus exactly 5.000s (its `ExecStartPre=/bin/sleep 5`).

The two instances are otherwise unrelated. Entware's runs the vendor-default config
(`/opt/etc/lighttpd/lighttpd.conf`, the empty `/opt/share/www/` docroot, port 80
only, no TLS). QManager's `lighttpd.service` runs
`/opt/sbin/lighttpd -D -f /usrdata/qmanager/lighttpd.conf` — the real docroot,
HTTPS on 443, the `/cgi-bin/` handler.

**Symptom when Entware wins:** `curl http://127.0.0.1/` → `403 Forbidden` (the empty
default docroot); `curl https://127.0.0.1/` → `Connection refused` (nothing is bound
to 443 at all). `systemctl status lighttpd` still misreports "active (running)",
because the cgroup — the kernel's per-unit process group, which systemd uses to
decide what a unit "owns" — happens to contain the imposter's PID.

#### Measured boot timeline (RG501Q-EU, 2026-08-25)

Times are **monotonic** — seconds since kernel boot, not wall clock. That matters
here because the device has no battery RTC and its wall clock is still 1970 at
these timestamps.

| t (monotonic) | Event |
| --- | --- |
| 20.08s | `start-opt-mount.service` begins |
| 20.33s | `rc.unslung.service` begins its `ExecStartPre=/bin/sleep 5` |
| 23.80s | `opt.mount` reaches active (3.7s after the wrapper started) |
| 24.15s | `lighttpd.service` begins `ExecStartPre … -tt` — itself a process named `lighttpd` |
| 25.33s | `S80lighttpd` runs `pidof`, sees it, stands down |
| 34.02s | QManager's lighttpd binds 80 **and** 443 |

**Margin: 1.18 seconds.** What shielded QManager on this boot was its own config
test (`lighttpd -tt`), which took **9.87s under boot load versus 0.22s idle** — a
process that exists only to validate a file, holding the name that decides the
outcome.

#### Evidence that it is intermittent, not deterministic (n=2)

Entware's error log lives on `ubi2_0`, so it survives reboots. It shows the
imposter starting on the **05:14** boot and **not** on the **05:35** boot, with
byte-identical on-disk config in both cases (the QManager deploy is timestamped
04:49, before both). One loss, one win. That is the whole measured sample: enough
to prove the outcome is not fixed, **not** enough to support any claim about how
often it goes wrong.

#### The fix

`neutralize_entware_lighttpd()` in `scripts/install_rm520n.sh` clears
`S80lighttpd`'s executable bit. `rc.unslung` selects what to run with
`find /opt/etc/init.d/ -perm '-u+x' -name 'S*'` — no allowlist, no `.disabled`
naming convention — so removing that one bit is a valid and sufficient disable.
The function is idempotent, never dies, and always returns 0; a failure degrades
to the pre-existing intermittent behaviour rather than aborting an install. The
full rationale (why it is called from `main()` rather than
`install_dependencies()`, why it must run *after* `opkg` re-extracts the file, and
why `chmod a-x` rather than a bare `chmod -x`) is in the commit message for
`952309e`.

**Post-fix validation: 3 reboot cycles on the RG501Q-EU, all passed.** The
acceptance test is Entware's error log, which only the imposter ever writes to — it
stayed at 4 lines throughout. Every boot produced exactly one lighttpd, running
QManager's config, holding both 80 and 443. A later listing of
`/opt/etc/init.d/` on that device (2026-08-25) still shows `S80lighttpd` at
`-rw-r--r--` — the guard has survived every reboot since.

> ⚠️ **Never document `/opt/etc/init.d/S80lighttpd stop` as a repair step.**
> `rc.func`'s `stop()` is `killall lighttpd` — the same name-only matching, applied
> destructively. It kills **QManager's** server too. The manual repair performed on
> 2026-08-25 appeared to work only because a `systemctl restart lighttpd.service`
> immediately followed it.

#### RM520N-GL status: confirmed exposed, latent, now fixed

Measured on-device 2026-08-25, serial `61368cd2` (identity proven from
`/proc/cmdline`, per the identity-proof rule under **Device access** above).
Everything below replaces the earlier "inference from the repo" section — the
device is **exposed**, the imposter had **never actually run** in the whole window it
could have, and on the boot that was captured the defect **fired and was won by
luck**.

**All four preconditions are present.** Nothing about this device escapes the
mechanism:

| Precondition | Measured on RM520N-GL |
| --- | --- |
| `/opt/etc/init.d/S80lighttpd` exists and is executable | Yes — mode was `-rwxr-xr-x`, so `rc.unslung`'s selector matched it |
| `rc.unslung.service` exists, is pulled into the boot, and runs | Yes — symlinked into `/lib/systemd/system/multi-user.target.wants/`, `ActiveState=active`, `ExecMainStatus=0` |
| `rc.unslung`'s selector is the exec-bit `find` | Yes — `find /opt/etc/init.d/ -perm '-u+x' -name 'S*'`, verbatim, identical to the RG501Q-EU |
| `rc.func`'s `start()` short-circuits on `pidof` | Yes — `if [ -n "\`pidof $PROC\`" ]; then … return 0; fi`, verbatim, with `PROCS=lighttpd` in `S80lighttpd` |

Also confirmed: the installer path is **not platform-gated in any way**.
`install_rm520n.sh`'s `case "$project_name"` (`:436-462`) sets no variable and
nothing downstream branches on it — the `RM520N*` and `RG501Q*` arms only print a
different `info` line.

##### The imposter has never executed on this device — not once

This is the strongest single piece of evidence, and it is longitudinal rather than
point-in-time. Entware's config puts both of lighttpd's own artifacts on the
**persistent** `ubi2_0` volume, so they survive reboots:

```
server.errorlog = "/opt/var/log/lighttpd/error.log"
server.pid-file = "/opt/var/run/lighttpd.pid"
```

Neither exists. `find /opt /usrdata -name 'error.log*'` returns nothing.

**The decisive part is the directory mtime, not the missing files.** `stat
/opt/var/log/lighttpd` reports `Modify: 2026-03-16 09:22:24` — the date the Entware
package was installed, untouched since. lighttpd opens its error log **before** it
binds a socket, so even an invocation that died instantly on a port collision would
have created the file and bumped that mtime. An unchanged mtime therefore means the
Entware lighttpd binary has not executed **a single time** since installation.
`rc.unslung.service` has existed since Aug 16, so the co-existence window in which
it could have run is Aug 16 → 2026-08-25.

##### On the measured boot, F8 fired — and was won by accident

Times are **monotonic** (seconds since kernel boot). Wall clock is meaningless on
these devices, which boot at Jan 1970.

| Unit | InactiveExit | ExecMainStart | ActiveEnter |
| --- | --- | --- | --- |
| `start-opt-mount.service` | 24.783 s | 24.783 s | 0 (oneshot, `ExecMainStatus=0` — see F9) |
| `opt.mount` | 29.010 s | — | 29.523 s |
| `dropbear.service` | 29.165 s | — | 29.165 s |
| `rc.unslung.service` | 24.321 s | 30.055 s | 32.870 s |
| `lighttpd.service` | 30.692 s | 35.123 s | 35.123 s |

The reasoning that pins down which branch `S80lighttpd` took — this is the
load-bearing part of the finding:

- `rc.unslung`'s whole run took **2.81 s** (30.055 → 32.870).
- `rc.func`'s spawn-wait loop is `LIMIT=10` with `sleep 1`, so a **failed** spawn
  would have cost **≥11 s**. It did not.
- A **successful** spawn would have bound port 80 at ~30 s, and QManager's
  `ExecStart` at 35.123 s would then have failed to bind. It did not — QManager's
  `lighttpd.service` is healthy with `NRestarts=0`.
- The only branch consistent with *all three* of a 2.81 s run, an untouched
  `/opt/var/log/lighttpd` mtime, and a healthy QManager server is the `pidof`
  **`return 0` short-circuit**.

**So what satisfied `pidof lighttpd` at 30.055 s?** QManager's `lighttpd.service`
began activating at 30.692 s but its main process only started at 35.123 s — a
**4.4-second `ExecStartPre` window** in which the only process on the box named
`lighttpd` is the transient `lighttpd -tt` config test. `rc.unslung` started at
30.055 s and still had to `find`+`sort` its scripts and source `S51dropbear` before
reaching `S80lighttpd`, which landed its `pidof` sample inside that shield.

> ⚠️ **Read this as the defect firing and being won by accident, not as a
> mitigation.** Nothing here is designed. The shield is a config-test process that
> exists to validate a file, and the outcome turns on `rc.unslung`'s
> `ExecStartPre=/bin/sleep 5` and the `/opt` mount ordering interleaving favourably
> on that particular boot. It would narrow if either `lighttpd.service`'s
> `ExecStartPre` or that `sleep 5` ever changed — and it is **not even a stable
> width across boots of the same device**: the shield measured **4.4 s** on this
> boot and **5.63 s** on the post-fix reboot below (28.562 → 34.195 s). A device
> still carrying the defect is relying on a quantity that moves by >25% boot to
> boot. For scale: the RG501Q-EU's
> equivalent shield was measured at 9.87 s under boot load and still left only
> **1.18 s** of margin. The RM520N-GL's 4.4 s shield is merely wide *relative to when
> `rc.unslung` happens to sample*, which is not a property anyone chose.

##### Resolved: `/opt` is the same bind mount on both devices

The earlier revision of this entry speculated that the RM520N-GL's `/opt` was a
*dedicated* UBIFS volume (UBIFS = the flash filesystem these modems use) mounted by
the kernel, unlike the RG501Q-EU's `/usrdata/opt` bind, and that this might change
when `/opt` becomes available. **That speculation is refuted.** Measured:

```
/dev/ubi2_0 on /usrdata type ubifs (rw,relatime,bulk_read,assert=read-only,ubi=2,vol=0)
/dev/ubi2_0 on /opt     type ubifs (rw,relatime,bulk_read,assert=read-only,ubi=2,vol=0)
```

and the unit is a plain bind:

```ini
[Unit]
Description=Bind /usrdata/opt to /opt
[Mount]
What=/usrdata/opt
Where=/opt
Type=none
Options=bind
```

Confirmed independently by content identity — `ls -la /usrdata/opt/etc/init.d/` is
byte-identical to `/opt/etc/init.d/`. **There is no `/opt`-shaped divergence between
the two devices**, and the fix therefore transfers cleanly *because* the topology is
identical, not in spite of a difference.

> ℹ️ NOTE: `opt.mount` had **no wants-symlink** on the RM520N-GL either — the mount
> was reached through the `start-opt-mount.service` wrapper. On a device that has
> not yet had the F8 change applied, a symlink-presence check is therefore a **false
> negative** for `opt.mount` specifically. That is a distinct trap from
> **F12** below, which is about `systemctl is-enabled` mislabelling symlinks that
> *do* exist.

##### Verification caveat: `rc.func`'s `logger` output goes nowhere here

On success `rc.func` calls `logger "Started $DESC from $CALLER."`. On the RM520N-GL
that never lands: grepping `/var/log/messages` and `/var/log/messages.0` for
`lighttpd|unslung|opt.mount` returned **zero lines**, while syslog was demonstrably
working for other sources at the same time. **Do not build a post-deploy or
health check on `rc.func`'s logging.** Use the `/opt/var/log/lighttpd` directory
mtime instead — it is the artifact that actually moves when the imposter runs.

##### Fix applied to the RM520N-GL, 2026-08-25

Applied **by hand** — `chmod a-x /opt/etc/init.d/S80lighttpd` (mode is now
`-rw-r--r--`) plus creation of the `opt.mount` wants-symlink. These are the same two
state changes the installer performs, but **the installer itself was not run**, so
follow-up 3 below stays open for this device too.

The decisive post-apply assertion is run against `rc.unslung`'s **own selector**
rather than a proxy for it:

```
/opt/bin/find /opt/etc/init.d/ -perm '-u+x' -name 'S*' | sort
→ /opt/etc/init.d/S51dropbear
```

`S80lighttpd` is no longer in the selection. Web health was unaffected by the
change: `http` → `301` (redirect to https), `https` → `200`, a single lighttpd PID,
nothing restarted.

##### Reboot validation — passed 2026-08-25, and what it does *not* prove

The device was rebooted after the hand-application (uptime 17490 s → fresh boot;
serial `61368cd2` re-proven from `/proc/cmdline`). Every acceptance criterion
passed:

| Criterion | Result |
| --- | --- |
| Guard survived the reboot | `/opt/etc/init.d/S80lighttpd` is `-rw-r--r--` |
| `rc.unslung`'s own selector excludes it | `/opt/bin/find /opt/etc/init.d/ -perm '-u+x' -name 'S*' \| sort` → `/opt/etc/init.d/S51dropbear` only |
| Imposter still never ran | `stat /opt/var/log/lighttpd` → `Modify: 2026-03-16 09:22:24`, **unchanged across the reboot**; `/opt/var/run/lighttpd.pid` absent; log dir empty |
| QManager healthy | `lighttpd.service` `ActiveState=active`, `NRestarts=0`, `ExecMainPID=1633`, holding both `0.0.0.0:80` and `0.0.0.0:443`; `http` → `301`, `https` → `200` |
| `opt.mount` | wants-symlink present, `ActiveState=active` |

> ⚠️ **Be precise about the strength of this result — it is easy to overclaim.**
>
> It **does** prove that the guard persists across a boot, that `rc.unslung`'s
> *actual* selector no longer matches `S80lighttpd`, and that nothing regressed.
>
> It does **not** prove "the race is gone on the RM520N-GL," because the race was
> never observed being *lost* on this device in the first place. The guard's value
> here is that it **removes a dependency on luck**, not that it repaired an observed
> failure.
>
> The strong evidence is the **mechanical** assertion — the `find` selector, which
> is timing-independent and therefore cannot be flattered by a lucky boot. The
> reboot is corroboration on top of it, not the primary proof.

Post-reboot monotonic timeline (post-fix; compare against the pre-fix table above):

| Unit | InactiveExit | ExecMainStart | ActiveEnter |
| --- | --- | --- | --- |
| `start-opt-mount.service` | 23.972 s | 23.971 s | 0 (`ExecMainStatus=0` — see F9) |
| `rc.unslung.service` | 23.345 s | 28.721 s | 31.730 s |
| `opt.mount` | 27.861 s | — | **28.404 s** |
| `dropbear.service` | 28.772 s | 28.772 s | 28.772 s |
| `lighttpd.service` | 28.562 s | 34.195 s | 34.195 s |

Two figures from this boot are the ones to quote elsewhere:

- **The `rc.unslung` vs `opt.mount` margin is 0.32 s** — `opt.mount` reached active
  at 28.404 s and `rc.unslung`'s `ExecStart` began at 28.721 s. That is *tighter*
  than the 0.5 s of the first boot, so **0.32 s is the worst measured margin** and
  is the number to use wherever the docs quote one. It is the subject of
  **[F14](#f14-open-deferred-on-measured-evidence--rcunslungservice-uses-execstartprebinsleep-5-where-it-needs-afteroptmount)**.
- **`lighttpd.service`'s `ExecStartPre` shield was 5.63 s here** versus 4.4 s on the
  first boot — the accidental shield the pre-fix device depended on is not a stable
  width.

> ℹ️ NOTE: the same `ExecStartPre=/bin/sleep 5` that F14 wants replaced is exactly
> what positioned `rc.unslung`'s `pidof` sample inside the `-tt` shield on the
> pre-fix boot above. **Any future F14 fix perturbs the F8 timing narrative** — it
> cannot reintroduce F8 (the exec bit is the guard, and it is timing-independent),
> but it does invalidate the measured margins recorded here.

#### Accepted tradeoff in the uninstaller

`uninstall_rm520n.sh` restores the executable bit (`chmod a+x`) when it removes
QManager's `lighttpd.service`; without that, uninstalling would strand the device
with no web server at all. The restore is **unconditional within its guard**, so a
user who had disabled `S80lighttpd` themselves *before* installing QManager gets it
re-armed on uninstall. The exec bit is the only state channel `rc.unslung` itself
consults, so there is nowhere to record the user's prior intent without adding an
installed artifact. Accepted deliberately.

#### Deferred F8 follow-ups

None of these block the fix; all of them bound how far it can be claimed.

| # | Work | Why it is still open |
| --- | --- | --- |
| ~~1~~ | ~~**Re-probe the RM520N-GL once reachable.**~~ | **DONE 2026-08-25.** All four preconditions confirmed present, the imposter proven never to have run, `/opt` proven to be the same `/usrdata/opt` bind as on the RG501Q-EU, and `opt.mount` present as a unit but unlinked. Answers folded into [RM520N-GL status](#rm520n-gl-status-confirmed-exposed-latent-now-fixed) above. |
| ~~2~~ | ~~**Boot-verify the fix on the RM520N-GL.**~~ | **DONE 2026-08-25.** Rebooted after the hand-application; guard persisted, selector excludes `S80lighttpd`, imposter log mtime unchanged, QManager healthy on 80+443. See [Reboot validation](#reboot-validation--passed-2026-08-25-and-what-it-does-not-prove) — note what that result does *not* prove. |
| 3 | **End-to-end installer run on hardware.** The fix was validated by applying, by hand, the two state changes the installer performs — not by running the installer itself on-device. | The plumbing is verified *statically*: 16 assertions in `scripts/test/installer-lighttpd-collision.sh` plus a CLEAR installer-safety audit. Static verification is not an execution. |
| 4 | **Root-cause the `opt.mount` boot-timing jitter** (22.25s on one boot vs ~4.5s on the next two, identical device, identical config). | Unexplained. See F11 below. |

### F9 (open, deliberately not fixed) — `start-opt-mount.service` never reaches `active`

Measured on the RG501Q-EU: `ActiveEnterTimestampMonotonic=0` — systemd's record of
"when did this unit become active" is zero, i.e. never — alongside a real
`InactiveExitTimestamp`, i.e. it genuinely started. The unit is a `Type=oneshot`
(a unit systemd considers finished when its command exits) whose command is
`/bin/systemctl start opt.mount`. Asking systemd to start another unit *from inside
a unit that is itself part of the current boot transaction* self-deadlocks: the
wrapper waits for the mount job, and the mount job is queued behind the
transaction the wrapper is in.

**The mount still happens.** Only the wrapper is a zombie — it never reports
completion.

**Reproduced on the RM520N-GL, 2026-08-25:** same signature —
`InactiveExit=24.783 s`, `ExecMainStart=24.783 s`, `ExecMainStatus=0`,
`ActiveEnter=0`. This is a shared platform behaviour, not an RG501Q-EU quirk.

**Deliberately kept** (decision recorded in `952309e`). `dropbear.service` — the SSH
daemon — runs `/opt/sbin/dropbear`, which lives under `/opt`. If `opt.mount`'s
enablement ever failed and this fallback had been removed, the device would lose
Entware, lighttpd **and** SSH simultaneously, with no remaining path in. Verified
harmless: no unit is ordered against it, and systemd coalesces duplicate start jobs,
so there is one `mount(8)` per activation regardless of how many callers ask.

### F10 (open) — `dropbear.service` fails on boot, intermittently

`NRestarts` measured **1 / 0 / 0** across the three post-fix reboots, and **1** on
the pre-fix boot. The unit declares `After=network.target` and nothing else — in
particular **no `After=opt.mount`**, despite `ExecStart=/opt/sbin/dropbear` living
on that mount. It also sets no `RestartSec=` and no `StartLimit*`. It survives
purely because `Restart=on-failure` retries it until `/opt` is there.

**It reproduces on the RM520N-GL too.** Previously this was an RG501Q-EU-only
observation; the 2026-08-25 RM520N-GL reboot came up with **`NRestarts=2`**, the
highest count seen on either device. So it is a shared platform defect, not a
per-device quirk — consistent with the missing `After=opt.mount` being the cause.

**Not resolved.** Two of three clean boots is not proof of anything, and the failure
correlates with the `opt.mount` timing jitter in F11 rather than tracking the F8 fix.
Fixing it means rewriting the SSH unit on an OTA upgrade — a lockout risk — so it was
deliberately scoped out; the unit is also written under an `if [ ! -f ]` guard, so it
cannot reach an existing device via OTA without converting that guard first.

### F11 (open) — `opt.mount` early-start is probabilistic, not guaranteed

Enabling `opt.mount` (symlinking it into `multi-user.target.wants/`) was the
*secondary* half of the F8 change: before it, the unit was written with
`WantedBy=multi-user.target` but never enabled, so it was never pulled into the boot
transaction and `lighttpd.service`'s `After=opt.mount` was inert.

Post-fix, across three reboots, `opt.mount` reached active at **22.25s, 4.64s, and
4.52s**. On cycle 1 that was *after* `rc.unslung` had already started (19.34s) —
reproducing the original timing window exactly. Nothing failed, because the exec bit
was already cleared.

> ⚠️ **Record this conclusion explicitly, because it is the one that matters for any
> future change here: the exec-bit clear is the load-bearing, deterministic part of
> the F8 fix. The `opt.mount` enablement is a secondary, probabilistic timing
> improvement and must never be relied on alone.** A future refactor that "simplifies
> away" the exec-bit clear on the grounds that the ordering now handles it would
> reintroduce F8 in full.

The 22.25s-vs-4.5s spread across identical boots is unexplained — see F8 follow-up 4.

### F12 (open, cosmetic but load-bearing for anyone reading it) — `systemctl is-enabled` reads `disabled` for units QManager enables

systemd-239 (and the RM520N-GL's minimal 244 build) only recognises **admin**
enablement symlinks, which live under `/etc/systemd/system/*.wants/`. QManager
deliberately places its start symlinks in `/lib/systemd/system/multi-user.target.wants/`
instead — see the installer's own comment at `scripts/install_rm520n.sh:3420`,
"`systemctl enable` does not work on RM520N-GL — direct symlink instead". The rootfs
boots `ro`, and `/etc/systemd/system/` is exactly where `systemctl enable` would want
to write.

The units are **functionally enabled**: they are pulled into `multi-user.target`,
they load correctly, and they start every boot. Only the `is-enabled` *label* is
wrong. This applies to **every** QManager unit, not just `opt.mount`.

> ⚠️ **Nothing may gate logic on `systemctl is-enabled`** — installer, health check,
> CGI, or agent probe. Check for the `.wants` symlink instead.
>
> ⚠️ **Do not "fix" this by moving the symlinks to `/etc/systemd/system/`.** That
> would change boot-dependency semantics (`/etc` units override `/lib` units by name,
> and drop-in resolution order changes with them) for a cosmetic label, on a rootfs
> that boots read-only.

See also the `systemd version` row and its NOTE under [Boot & time](#boot--time),
which records the same behaviour as a per-device fact.

### F13 (fixed 2026-08-26, `d7f30fb`, security — BOTH devices) — three Entware systemd units were world-writable (`0666`)

**Short version: three unit files that systemd runs as root at boot can be edited by
any user on the box, including `www-data`.** Measured on **both** devices,
2026-08-25 — this is a platform-wide defect, not an RM520N-GL quirk:

| Unit | Mode (RM520N-GL) | Mode (RG501Q-EU) | Owner | Pulled into boot by |
| --- | --- | --- | --- | --- |
| `/lib/systemd/system/rc.unslung.service` | `-rw-rw-rw-` | `-rw-rw-rw-` | `root:root` | `WantedBy=multi-user.target` |
| `/lib/systemd/system/opt.mount` | `-rw-rw-rw-` | `-rw-rw-rw-` | `root:root` | `WantedBy=multi-user.target` |
| `/lib/systemd/system/start-opt-mount.service` | `-rw-rw-rw-` | `-rw-rw-rw-` | `root:root` | pulled as the `opt.mount` fallback |

**How they got that way.** All three are written by plain heredocs in
`scripts/install_rm520n.sh` — `cat > file << 'EOF'`, around `:1002`, `:1020` and
`:1089` — with **no `chmod` afterward anywhere in the file**. Shell `>` redirection
creates a file at `0666` minus the `umask` (the per-process mask of permission bits
the kernel strips from newly created files). A measured `0666` therefore means the
shell that ran the first install had a `umask` of **0**. The mode is inherited
ambient state, not a decision.

**Two devices landing on the same mode is what makes that explanation solid.** The
RG501Q-EU's units carry mtimes of **Jun 22** (`opt.mount`,
`start-opt-mount.service`) and **Aug 25** (`rc.unslung.service`) — bootstrapped
months apart, on a different SoC, and still `0666` on all three. A one-off `umask`
accident on a single box would not reproduce like that; an installer whose heredocs
run under a `umask 0` environment would.

**Why living on the read-only rootfs does not make this moot.** `preflight()`
remounts `/` read-write (`install_rm520n.sh:492`), and this project's documented
convention is to **never remount it back to `ro`** (see the comment at `:2902`). So
on any device that has run the installer, `/lib` is permanently writable *at the
mount level*, and the file mode is the only barrier left. An unprivileged local
process — including `www-data`, if a CGI bug ever yields a shell — can rewrite
`ExecStart=` in a unit that runs as root on the next boot. This is the same bug
class as the `install -d -m 0755` findings already recorded in this project:
permissions inherited rather than asserted.

**Why OTA does not already fix it.** The heredocs sit inside `if !
qm_entware_complete` *and* per-file `if [ ! -f ]` guards, so on an
already-installed device they never re-execute. The bad modes survive every
upgrade.

**Fix — shipped 2026-08-26.** `harden_entware_unit_modes()` in
`scripts/install_rm520n.sh`, defined alongside `neutralize_entware_lighttpd()` and
called **unconditionally from `main()`** immediately after it: it loops the three
paths behind a `[ -f ]` guard, applies a **numeric** `chmod 0644`, and `sync`s.

- **Numeric, not symbolic.** A numeric mode sets exact bits regardless of `umask`
  and is idempotent whatever mode the file already carries — so unlike the
  `chmod a-x` in the F8 fix it needs no `a` prefix workaround.
- **Unconditional in `main()`, not inside `install_dependencies()`.** That is the
  whole delivery mechanism: OTA invokes the installer with `--skip-packages`, which
  gates `install_dependencies()` where the heredocs live, so a fix placed there
  would reach fresh installs only and leave every existing device `0666` forever.
  Same defect shape as F8, same precedent for the cure.
- **Warn-only.** A failed `chmod` degrades to the pre-fix state; it must never
  abort an install.
- **No `daemon-reload`.** Changing a file's mode does not make systemd re-parse the
  unit, and the change is safe on an already-loaded, active unit.

Pinned by `scripts/test/installer-unit-modes.sh` (13 assertions, auto-discovered by
`run-harnesses.sh`), whose paranoid assertion is [3]: the call site must be
ungated and must not sit inside `install_dependencies()`. Verified to fail against
`git show HEAD:scripts/install_rm520n.sh` before the fix (8 failures) and pass
after.

##### Checked and clear: the containing directory is NOT loose

The obvious worse version of this bug — a world-writable
`/lib/systemd/system/` — **does not exist.** Measured on the RG501Q-EU 2026-08-25:

```
drwxr-xr-x   24 root     root         23328 Aug 25 04:49 /lib/systemd/system
```

`0755`, root-owned: the vendor default, exactly as the audit predicted, and
consistent with no installer code ever creating or `chmod`-ing that directory.

**This bounds the severity ceiling, so do not re-derive it.** The escalation path is
limited to **overwriting those three existing files**. It does **not** extend to
creating new units: an unprivileged process cannot add a `.service` of its own to
`/lib/systemd/system/`, cannot drop in an override directory there, and cannot
rename or delete the three files — only rewrite their contents in place. Bad enough
(an `ExecStart=` in a root-run unit), but bounded and enumerable.

### F14 (open, deferred on measured evidence) — `rc.unslung.service` uses `ExecStartPre=/bin/sleep 5` where it needs `After=opt.mount`

**Short version: a unit whose whole job is to run a file on `/opt` waits for that
mount with a hardcoded 5-second sleep instead of telling systemd about the
dependency.** `rc.unslung.service` executes `/opt/etc/init.d/rc.unslung`, which does
not exist until `opt.mount` is active. It declares **no `After=` at all**.

**Worst measured margin: 0.32 s** — the 2026-08-25 RM520N-GL reboot, where
`opt.mount` reached active at 28.404 s and `rc.unslung`'s `ExecStart` began at
28.721 s. That is not a stable 0.32 s: **F11** already established that `opt.mount`
timing is probabilistic on the RG501Q-EU, ranging **4.5 s to 22.25 s across
identical boots**. A mount slower than the sleep makes `rc.unslung.service` fail
outright with `ENOENT`.

**Blast radius, post-F8 — this is why it is deferred rather than fixed:**

- It **cannot reintroduce F8.** `S80lighttpd`'s exec bit is cleared, so
  `rc.unslung`'s own `find` selection skips it whether `rc.unslung.service` runs or
  not. The F8 guard is timing-independent by construction.
- **SSH survives.** The only other `S*` script present is `S51dropbear`, which is
  redundant with the independent systemd `dropbear.service` — and that unit orders
  only on `network.target` (see F10), not on `rc.unslung`.
- **The blast radius is now measured, and it is nil.** This was the open question
  gating closure — whether any of the ~43 installed Entware packages ships another
  `S*` init script depending on `rc.unslung` succeeding. Full directory listing,
  RG501Q-EU 2026-08-25:

  ```
  -rwxr-xr-x    1 root     root           736 Jan  8  2025 S51dropbear
  -rw-r--r--    1 root     root           215 Mar 16 09:22 S80lighttpd
  -rw-r--r--    1 root     root          2822 Mar 15 12:03 rc.func
  -rwxr-xr-x    1 root     root           966 Mar 15 12:03 rc.unslung
  ```

  `S51dropbear` and `S80lighttpd` are the **only** `S*` scripts that exist — the same
  two as on the RM520N-GL. So an `ENOENT` failure of `rc.unslung.service` costs
  exactly one thing: Entware's redundant `S51dropbear`, superseded by the independent
  systemd `dropbear.service`. Nothing else is downstream of it.

> ℹ️ **Disposition: deferred on measured evidence, not deferred pending
> investigation.** Nothing is waiting on further probing — the failure mode is known
> and benign. It stays **open** rather than closed because the hardcoded `sleep 5` is
> still a latent fragility worth removing, not because anything is unknown.

**Fix pattern if it is ever taken:** `After=opt.mount` **only** — *not* `Requires=`.
Ordering already enforces the real dependency; `Requires=` would add a hard-fail
propagation mode for nothing. This does **not** interact with F9's self-deadlock:
F9 is a *runtime* `systemctl start` call issued from inside a unit's own
`ExecStart`, whereas `After=` is declarative metadata resolved before the boot
transaction is even built.

Shipping it is the awkward part. `rc.unslung.service` is a **write-once** unit
(the `if [ ! -f ]` guard from F13), so delivery needs an idempotent targeted patch
called from `main()` — guarded on the string already being present — plus a
`daemon-reload`, and it takes effect only on the *following* boot. That is the same
risk class as **F10**, and it should inherit F10's disposition rather than jump
ahead of it.

> ℹ️ NOTE: the `sleep 5` this entry wants replaced is the same quantity that put
> `rc.unslung`'s `pidof` sample inside `lighttpd.service`'s `ExecStartPre` shield on
> the pre-fix RM520N-GL boot recorded under **F8**. Fixing F14 does not resurrect
> F8 — but it does invalidate every timing margin quoted in that entry, so the two
> must be re-measured together.

## AT transport

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| AT device node | `/dev/smd11` (Qualcomm SMD char device, not a UART) | **`/dev/smd11` exists** | RM520N-GL: on-device · `at-command-transport.md`. RG501Q-EU: adb 2026-08-25 — stock firmware |
| Default node permissions | `crw------- root:root` | **`crw------- root root`** — matches | RM520N-GL: on-device · `qmanager-independence.md`. RG501Q-EU: adb 2026-08-25 — stock firmware |
| udev subsystem | `glinkpkt` (sysfs `/sys/class/glinkpkt/smd11`) | *unverified* — **see PRAIRIE note below** | on-device · `qmanager-independence.md:273` |
| `smd11` creation timing | Exists before `qmanager-setup.service` runs | *unverified* — **see PRAIRIE note below** | on-device |
| termios | Returns `ENOTTY` for `tcgetattr`/`tcsetattr` | *unverified* | on-device · `sms.md` |
| URC listener | None resident; `smd11` **not** selectable via `AT+QURCCFG="urcport"` (only `usbat`/`usbmodem`/`uart1`/`all`) | *unverified* | live `/proc/*/fd/*` scan · `at-command-transport.md` |
| `AT+CGAUTH` | **Unsupported** — returns `ERROR`; use `AT+QICSGP` | *unverified* | on-device · `wan-profile-management.md:81` |
| Per-context MTU write | No reliable write; `+CGCONTRDP` returns no MTU field | *unverified* | on-device · `wan-profile-management.md:400` |
| `+CGCONTRDP` IPv6 format | 16 dotted-decimal octets; gateway quoting varies between reads | *unverified* | on-device 2026-08-03 |

### PRAIRIE-family note — a hypothesis, not a measurement

Two existing docs already record deviations on **PRAIRIE-derived** platforms:

- `qmanager-independence.md:273-281` — the udev rule deliberately omits
  `SUBSYSTEM==` because the subsystem name differs off RM520N-GL, and on
  PRAIRIE platforms the modem re-creates `/dev/smd11` **after**
  `qmanager-setup.service` completes, so the one-shot's guard returns false and
  permissions end up wrong.
- `docs/BACKEND.md:1031` — same udev reasoning.

**Both were established against RG502Q / RM502Q, not RG501Q-EU.** Same SDX55
family, different model. They are the strongest starting hypotheses we have for
Phase B — and they are still hypotheses. Do not promote either to a measured
fact for RG501Q-EU without probing it. If the boot-ordering deviation does hold,
it is a real bug on the new target, not a cosmetic difference.

## Network interfaces

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Ethernet controller | Realtek RTL8125B 2.5GbE as `eth0`, out-of-tree `r8125` driver | *unverified* — **may not exist at all** | on-device · `ethernet.md` |
| Ethernet during attach cycle | PHY drops ~4s on every `AT+COPS=0` re-attach | *unverified* — **likely inapplicable** | on-device, 2 runs |
| TTL interface | `rmnet+` | *unverified* | on-device |
| WAN data interface | Not fixed — the `rmnet_dataN` index migrates across attach cycles | Default route `via 10.216.218.18 dev **rmnet_data0**`, mtu 1500, at this boot. Whether the index migrates here is *unverified* (single boot, no attach cycle run) | RM520N-GL: on-device · `wan-profile-management.md:418`. RG501Q-EU: adb 2026-08-25 — device state |
| LAN / bridge mode | n/a — `eth0` carrier board | **Router mode, not passthrough** — `bridge0` is `192.168.225.1/24` with `MASQUERADE` on `rmnet_data0` | RG501Q-EU: adb 2026-08-25 — device state (see the identity warning at the top) |
| LAN gateway config (`/etc/data/mobileap_cfg.xml`) | Present; `<APIPAddr>192.168.225.1</APIPAddr>`, `<GatewayURL>` node also present (see `LAN_settings.sh`) | **Present, same schema** — `radio:radio 0755`, 6910 bytes; `<APIPAddr>192.168.225.1</APIPAddr>`, `<GatewayURL>mobileap.qualcomm.com</GatewayURL>` | RG501Q-EU: adb 2026-08-25 (`b7e3d6f1`) — post-reset state |
| Outbound IP reachability | n/a | DNS resolves (`10.151.151.44`, `10.151.151.48`); **TCP connects but payloads are reset** — `1.1.1.1:443` connects in 88 ms then `gnutls_handshake() failed: Error in the pull function`; `http://example.com/` → `curl (56) Recv failure: Connection reset by peer`. Cause *unverified* | RG501Q-EU: adb 2026-08-25 — device state |
| Counter orientation (`/proc/net/dev`) | normal (rx=DL, tx=UL) | *unverified* — see the orientation note below | `data-counter-platform-matrix.md` — already per-SoC |

**The Ethernet rows carry the largest form-factor risk in this table.** RTL8125B
sits on the **M.2 carrier board**, not inside the modem. RG501Q-EU is LGA — a
different carrier board entirely, which may route Ethernet differently or not at
all. The ~4s attach-cycle link drop is therefore probably a property of *our
board*, not of *the modem*, and should be treated as inapplicable until proven
otherwise.

**On the RG501Q-EU payload resets — cause is `*unverified*`; do not guess.** Local
`iptables` was ruled out on 2026-08-25: OUTPUT policy is `ACCEPT`, the only DROPs
are inbound 443/80 on `rmnet_data0` with **0 packets**, and there is no TTL mangle
rule. That leaves an upstream/carrier-side cause, which was **not** identified. It
is not recorded here as a finding — only as a blocker on anything that needs
outbound HTTPS from this device (OTA, Entware bootstrap, language packs).

**On counter orientation — a hypothesis, not a measurement.** An **RM502Q-AE**
(SDX55, community tier) probe found `/proc/net/dev` rx/tx labels reversed on
*some* IPA driver builds — the source hedges deliberately, and a slow-path test
on the same part showed correct labels. Schema v5 keys a static orientation map
on `Branch Name`, so an RG501Q-EU reporting `SDX55` **would inherit** the
reversed map. Two reasons that is not a measurement: it was established on a
different model, and `Branch Name` for RG501Q-EU is itself `*unverified*` (see
the header table) — it is a map lookup on an unmeasured key. Treat as a Phase-B
hypothesis to test, never as a known value.

## `/etc/qmanager/platform.json` — advisory hardware profile

Written at installer preflight as of Phase A T2. **Advisory only** — nothing
gates on it; it records what the installer detected.

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| `/etc/qmanager/platform.json` | `model` `RM520NGL_VC`, `soc` `SDX6X`, `form_factor` `m2`, `tier` `official` — **MEASURED**, not derived | `model` `RG501QEU_VD`, `soc` `SDX55`, `form_factor` `lga`, `tier` `community` — derived from the header-table values | RM520N-GL: the generator was **run on the live device** 2026-08-25 to a `/tmp` scratch path (read-only w.r.t. `/etc`; output validated by device `jq` 1.7.1, `od -c` LF-only, scratch removed). RG501Q-EU: emitted byte-exactly by `scripts/test/installer-platform-json.sh` from real device bytes — not yet run on that hardware |
| Present on device | **Absent today** | **Absent today** | Neither device has been reinstalled since Phase A T2 |

Schema `1`; fields `model`, `soc`, `form_factor`, `tier`, `fw_fingerprint`,
`caps`. `scripts/usr/lib/qmanager/hw_profile.sh` is the **single writer**, and it
is **printf-only with no `jq` dependency** — preflight runs before Entware is
bootstrapped, so `/opt/bin/jq` may not exist yet (the RG501Q-EU's empty `/opt`
above is exactly that situation).

## CPU & ABI

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Core | Single-core ARMv7-A Cortex-A7 @ ~1.2 GHz | *unverified* | on-device · `docs/BACKEND.md:1647` |
| RAM | 178 MB + ~91 MB zram swap | *unverified* | on-device |
| Float ABI | `vfp vfpv3 vfpv4 neon` in `/proc/cpuinfo` — armhf hard-float runs natively | **Same** — `/proc/cpuinfo` `Features:` line carries `vfp vfpv3 vfpv4 neon`; hard-float binaries are safe | RM520N-GL: on-device `/proc/cpuinfo`. RG501Q-EU: adb 2026-08-25 (`b7e3d6f1`) — confirmed live by running the hard-float `atcli_smd11` (`e_flags 0x5000400`, VFP bit set) via `atcli_smd11 'AT'`, which returned the command echo + `OK`, exit 0, no `SIGILL` |
| `aarch64` | Will not run | *unverified* | inferred from ARMv7-A |
| glibc | 2.31 | *unverified* | on-device |
| Kernel | `5.4.210-perf` | **`4.14.206`** PREEMPT | RM520N-GL: on-device 2026-05-09. RG501Q-EU: adb 2026-08-24 · `rg501q-bringup.md` — stock firmware |
| `uname -m` | `armv7l` | **`armv7l`** | RG501Q-EU: adb 2026-08-24 — stock firmware |
| Entware target | `armv7sf-k3.2` | **`armv7sf-k3.2`** — same as RM520N-GL; the device's own `/opt/etc/opkg.conf` carries `arch armv7-3.2 160`, matching the bundled `.ipk` suffix | RG501Q-EU: adb 2026-08-24, plus a successful 44-package bootstrap 2026-08-25 |

**Float ABI was the highest-consequence unverified row — resolved 2026-08-25.**
SDX55 is a genuinely different SoC, not a revision of SDX65, so VFP support
could not be assumed to carry over: a hard-float binary on a CPU without VFP
crashes with `SIGILL` at runtime rather than degrading gracefully. `atcli_smd11`
(already present at `/usr/bin/atcli_smd11` on this device, byte-identical to
`dependencies/atcli_smd11` — a leftover from the pre-reset install, since
`/usr/bin` lives on the rootfs that the factory reset didn't touch) is a
hard-float build, and it ran cleanly. Still probe `/proc/cpuinfo` before
shipping any *new* native binary to this target — this result confirms the SoC
has VFP, not that every future binary's other assumptions hold.

---

## Known gaps blocking Phase B

### Test-device credentials are singular

Every SSH reference in the repo uses one flat triad — `MODEM_IP`,
`MODEM_SSH_USER`, `MODEM_SSH_PASSWORD` — with no device qualifier. Probing a
second modem requires either a per-device prefix or a selector variable.

Three files plus one agent memory hardcode the single-device assumption:

| File | What assumes one device |
| --- | --- |
| `CLAUDE.md` | "Credentials are in `.env`" — the Live Device Access section |
| `.claude/agents/modem-investigator.md` | The canonical PowerShell connection snippet |
| `.claude/agents/busybox-portability-checker.md` | Same snippet, restated |
| `.claude/agent-memory/modem-investigator/stale_env_ssh_password.md` | "ask the user to refresh `MODEM_SSH_PASSWORD`" — no notion of *which* device |

**Deliberately not solved in Phase A0.** Choosing a scheme without a second
device to test it against is guesswork; it is a Phase-B prerequisite. Never print
a credential value into a transcript — reference variable names only.

The RG501Q-EU has so far been reached over **adb** (serial `b7e3d6f1`), not SSH,
which sidesteps the credential problem but not the `192.168.225.1` address
collision — see the identity warning at the top.

## Open questions for Phase B

Each becomes a filled cell above once measured:

- Does `eth0` exist on the RG501Q-EU carrier board at all, and does
  `qmanager_ethernet_apply` have anything to apply to?
- What is the udev subsystem name for `smd11`, and does the PRAIRIE
  boot-ordering deviation reproduce on this specific model?
- Is there a battery RTC, or does the 1970 boot window apply identically?
- Is `crond` present *and running*, making the systemd-timer machinery
  unnecessary?
- ~~Does the rootfs `ro` / `ubi2_0` volume split match?~~ **Answered 2026-08-25:
  yes** — and `ubi2_0` additionally backs `/opt`, which is why a factory reset
  wipes the whole Entware tree.
- ~~Does the CPU expose VFP, so hard-float binaries are safe?~~ **Answered
  2026-08-25: yes** — `/proc/cpuinfo` carries `vfp vfpv3 vfpv4 neon`, confirmed
  live by running the hard-float `atcli_smd11` binary.
- Does the device `jq` have ONIGURUMA, and does BusyBox `flock` support the
  bare-FD form? (Still open — but `jq` now **exists** on the RG501Q-EU as of the
  2026-08-25 bootstrap, so both are finally testable.)
- What resets outbound TCP payloads on the RG501Q-EU? Local `iptables` is ruled
  out; the cause is upstream and unidentified. It no longer blocks the Entware
  bootstrap — that completed over plain HTTP on 2026-08-25 — but it is still
  unexplained and still a risk for anything needing outbound **HTTPS**.
- Is `AT+CGAUTH` supported, and is there a per-context MTU write?
