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

## ⚠️ Prove device identity before recording any capture

Both devices answer on **`192.168.225.1`**: that is the RM520N-GL's `MODEM_IP`,
and it is also the RG501Q-EU's `bridge0` address. They cannot both sit on the
host's Ethernet at once, and an IP alone never tells you which one replied.

Prove identity first, every session, and record the proof alongside the capture:

```sh
cat /etc/quectel-project-version   # Project Name: RM520NGL_VC | RG501QEU_VD
grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline   # 61368cd2 | b7e3d6f1
```

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
> `is-enabled`.

## Filesystem & partitions

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Rootfs | `ubi0:rootfs`, boots **`ro`** — proof is `ro` in `/proc/cmdline`, not `/proc/mounts` | **Same** — `/proc/cmdline` carries `ro`, `root=ubi0:rootfs`, `rootfstype=ubifs`, `ubi.mtd=30 ubi.mtd=25` | RM520N-GL: on-device · `qmanager-independence.md`. RG501Q-EU: adb 2026-08-25 (`b7e3d6f1`) — stock firmware |
| `/etc` + `/usrdata` | Same UBIFS volume `ubi2_0`, always rw, no remount needed | **Same, plus `/opt`** — `/dev/ubi2_0` backs `/usrdata`, `/etc` **and** `/opt`, all `ubifs rw,relatime,bulk_read` | RM520N-GL: reboot-proven 2026-08-10. RG501Q-EU: adb 2026-08-25 `/proc/mounts` — stock firmware |
| `/tmp` | tmpfs, `root:root 1777`, ~89 MB, cleared every boot | `tmpfs rw,nosuid,nodev` and **exec-capable** (a `chmod +x` script in `/tmp` ran); mode and size *unverified* | RM520N-GL: on-device · `tmp-file-ownership.md`. RG501Q-EU: adb 2026-08-25, probe file removed — stock firmware |
| adb shell UID | n/a (SSH) | `uid=0(root)` | adb 2026-08-25 — stock firmware |
| `fs.protected_regular` | `=1` — blocks **root** (not www-data) from write-opening another UID's file in a sticky dir | *unverified* | on-device · `tmp-file-ownership.md` |
| Cross-FS `mv` | `/tmp`→`/etc` gets `EXDEV`; degrades to copy+unlink | *unverified* | inferred from the volume split above |
| `pid_max` | 32768; PID churn ~100/s ⇒ wraps in ~325s | *unverified* | on-device · `tmp-file-ownership.md` |

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
| `printf %q` | **Fails** | **Fails** | on-device 2026-08-25, both devices — not a divergence, just never available |
| `lighttpd` | Entware only, `/opt/sbin/lighttpd` — no vendor build | **Two of them.** Vendor `/usr/sbin/lighttpd` ships in the stock image; QManager still installs and uses the Entware build at `/opt/sbin/lighttpd`. The vendor binary is left in place, unused | RG501Q-EU: adb 2026-08-24 · `rg501q-bringup.md` — stock firmware |
| `/opt/sbin` | Created by the `entware-opt` package | **Does not exist** before Entware is bootstrapped; the installer now creates it up front (`dropbear.service` hardcodes `ExecStart=/opt/sbin/dropbear`) | RG501Q-EU: adb 2026-08-25 with `/opt` empty — **post-reset / pre-bootstrap state** |
| CA bundle | *unverified* | `/etc/ssl/certs/ca-certificates.crt`, 200061 bytes, dated Feb 21 2025 | RG501Q-EU: adb 2026-08-25 — stock firmware |
| Shell arithmetic | BusyBox `sh` is 32-bit signed (wraps past 2.15 GB); bash 3.2 is 64-bit | *unverified* | on-device · `data-usage-counter.md` |
| Entware `jq` | `/opt/bin/jq` 1.7.1, built **without** ONIGURUMA — `gsub`/`test`/`match` abort at runtime | **Installed 2026-08-25** by the fixed installer; whether this build carries ONIGURUMA is still *unverified* — do not assume it matches the RM520N-GL row either way | RM520N-GL: on-device · `alerts.md`, re-confirmed 2026-08-25. RG501Q-EU: installed by a live installer run 2026-08-25; regex support not probed |
| `opkg` / Entware tree | `/opt/bin/opkg`, dedicated UBIFS volume | **Bootstrapped 2026-08-25** — 44 packages, after the installer fix below. Before that fix `/opt` held only a half-written `opkg` and zero packages. Not a dedicated volume here: `/opt` is a bind of `/usrdata/opt` on `ubi2_0`, so a factory reset wipes it | RG501Q-EU: adb 2026-08-25 — **post-reset state**, then a live full installer run the same day |
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
